/**
 * CELLO-PERSIST-008 — Analytics cron job.
 *
 * Computes per-pseudonym statistics, conversation graph edges, and graph analysis
 * results from the append-only protocol tables. Writes derived output into three
 * UPSERT-capable output tables.
 *
 * Security design (SI-001, SI-002):
 *   - readPool:  connects as cello_analytics (SELECT-only on protocol tables)
 *   - writePool: connects as cello_service (INSERT/UPDATE on output tables only)
 *   A compromised analytics job cannot INSERT into protocol tables.
 *
 * Observability events (canonical taxonomy):
 *   analytics.job.started    INFO  { runId, triggeredBy }
 *   analytics.job.completed  INFO  { runId, durationMs, pseudonymCount, edgeCount }
 *   analytics.job.failed     ERROR { runId, reason, phase }
 *   analytics.job.stale      WARN  { lastSuccessfulRunAt }
 *
 * Three phases:
 *   1. pseudonym_stats     — read conversation_participation + conversation_attestations +
 *                            conversation_seals; UPSERT into pseudonym_stats; DELETE stale rows
 *   2. graph_edges         — read conversation_participation + conversation_seals;
 *                            UPSERT into conversation_graph_edges; DELETE stale rows
 *   3. graph_analysis      — read conversation_graph_edges; compute clustering coefficient,
 *                            community assignment (connected components), conductance score;
 *                            UPSERT into graph_analysis_results; DELETE stale rows
 *
 * All three phases run within the same write transaction so that a failure in any
 * phase rolls back all output writes (AC-006, DB-001).
 *
 * Pseudocode:
 *   runAnalyticsJob(readPool, writePool, logger, runId):
 *     startMs = Date.now()
 *     logger.info("analytics.job.started", { runId, triggeredBy: "scheduler" })
 *     TRY:
 *       BEGIN TRANSACTION on writePool
 *
 *       Phase 1: pseudonym_stats
 *         SELECT pseudonym stats from protocol tables via readPool
 *         UPSERT into pseudonym_stats
 *         DELETE stale rows (pseudonyms no longer in protocol tables)
 *
 *       Phase 2: conversation_graph_edges
 *         SELECT edge data from protocol tables via readPool
 *         UPSERT into conversation_graph_edges
 *         DELETE stale edges
 *
 *       Phase 3: graph_analysis_results
 *         READ conversation_graph_edges from writePool (inside same tx)
 *         Compute clustering coefficients, communities, conductance
 *         UPSERT into graph_analysis_results
 *         DELETE stale rows
 *
 *       COMMIT TRANSACTION
 *       logger.info("analytics.job.completed", { runId, durationMs, pseudonymCount, edgeCount })
 *     CATCH err:
 *       ROLLBACK TRANSACTION
 *       logger.error("analytics.job.failed", err, { runId, reason, phase })
 *       RETHROW
 */

import pg from "pg";
import type { Logger } from "@cello/interfaces";

// ─── Graph data structures for in-memory analysis ────────────────────────────

interface EdgeRow {
  pseudonym_a: string;
  pseudonym_b: string;
  edge_weight: string;
}

interface PseudonymStatsRow {
  party_pseudonym: string;
  conversation_count: string;
  unique_counterparty_count: string;
  clean_count: string;
  flagged_count: string;
  last_activity: Date | null;
}

/**
 * AnalyticsJob — computes per-pseudonym stats, graph edges, and graph analysis results.
 *
 * Constructor parameters:
 *   readPool  — pg.Pool connected as cello_analytics (SELECT-only on protocol tables)
 *   writePool — pg.Pool connected as cello_service (UPSERT/DELETE on output tables)
 *   logger    — injected Logger (never console.log)
 */
export class AnalyticsJob {
  readonly #readPool: pg.Pool;
  readonly #writePool: pg.Pool;
  readonly #logger: Logger;

  constructor(readPool: pg.Pool, writePool: pg.Pool, logger: Logger) {
    this.#readPool = readPool;
    this.#writePool = writePool;
    this.#logger = logger;
  }

  /**
   * Run the analytics job once.
   *
   * Throws if any phase fails (after logging analytics.job.failed and rolling back).
   * On success, logs analytics.job.completed and records the run in analytics_run_log.
   *
   * @param runId - Unique identifier for this run (UUID). Appears in all log events.
   * @param triggeredBy - Who triggered this run. Default: "scheduler".
   */
  async run(runId: string, triggeredBy = "scheduler"): Promise<void> {
    const startMs = Date.now();

    this.#logger.info("analytics.job.started", { runId, triggeredBy });

    // Phase tracking for error context
    let currentPhase = "init";
    const writeClient = await this.#writePool.connect();

    try {
      await writeClient.query("BEGIN");

      // ─── Phase 1: pseudonym_stats ─────────────────────────────────────────
      currentPhase = "pseudonym_stats";

      /*
       * Read per-pseudonym stats from the read pool (cello_analytics — SELECT-only).
       *
       * For each pseudonym in conversation_participation:
       *   - conversation_count: number of conversations they participated in
       *   - unique_counterparty_count: number of distinct other pseudonyms they conversed with
       *   - clean_count: number of CLEAN attestations they received
       *   - flagged_count: number of FLAGGED attestations they received
       *   - last_activity: most recent conversation seal_date
       *
       * Joins:
       *   conversation_participation cp
       *     JOIN conversation_seals cs ON cs.conversation_id = cp.conversation_id
       *     LEFT JOIN conversation_attestations ca ON ca.conversation_id = cp.conversation_id
       *                                            AND ca.participant_pseudonym = cp.party_pseudonym
       * Group by cp.party_pseudonym
       *
       * unique_counterparty_count uses a subquery to count distinct other pseudonyms
       * in the same conversations.
       */
      const statsRows = await this.#readPseudonymStats();

      // UPSERT into pseudonym_stats using writeClient (cello_service — has INSERT/UPDATE)
      const statsUpsertValues: string[] = [];
      const statsUpsertParams: unknown[] = [];
      let pi = 1;

      for (const row of statsRows) {
        statsUpsertValues.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, now())`);
        statsUpsertParams.push(
          row.party_pseudonym,
          parseInt(row.conversation_count, 10),
          parseInt(row.unique_counterparty_count, 10),
          parseInt(row.clean_count, 10),
          parseInt(row.flagged_count, 10),
          row.last_activity,
        );
      }

      if (statsUpsertValues.length > 0) {
        await writeClient.query(
          `INSERT INTO pseudonym_stats
             (pseudonym, conversation_count, unique_counterparty_count, clean_count, flagged_count, last_activity, computed_at)
           VALUES ${statsUpsertValues.join(",")}
           ON CONFLICT (pseudonym) DO UPDATE SET
             conversation_count        = EXCLUDED.conversation_count,
             unique_counterparty_count = EXCLUDED.unique_counterparty_count,
             clean_count               = EXCLUDED.clean_count,
             flagged_count             = EXCLUDED.flagged_count,
             last_activity             = EXCLUDED.last_activity,
             computed_at               = EXCLUDED.computed_at`,
          statsUpsertParams,
        );
      }

      // DELETE stale pseudonym_stats rows — pseudonyms no longer in protocol tables
      // Use the set of pseudonyms returned by this run; any row not in the set is stale.
      const activePseudonyms = statsRows.map((r) => r.party_pseudonym);
      if (activePseudonyms.length > 0) {
        await writeClient.query(
          `DELETE FROM pseudonym_stats WHERE pseudonym != ALL($1)`,
          [activePseudonyms],
        );
      } else {
        // No active pseudonyms: clear everything
        await writeClient.query(`DELETE FROM pseudonym_stats`);
      }

      const pseudonymCount = statsRows.length;

      // ─── Phase 2: conversation_graph_edges ───────────────────────────────
      currentPhase = "graph_edges";

      /*
       * Compute edge weights: for each pair of pseudonyms that share a sealed
       * conversation, count the number of conversations between them.
       *
       * Canonical ordering: pseudonym_a < pseudonym_b (lexicographic) to avoid
       * duplicates for the unordered pair (A, B) = (B, A).
       *
       * Query:
       *   SELECT
       *     LEAST(p1.party_pseudonym, p2.party_pseudonym) AS pseudonym_a,
       *     GREATEST(p1.party_pseudonym, p2.party_pseudonym) AS pseudonym_b,
       *     COUNT(DISTINCT p1.conversation_id) AS edge_weight
       *   FROM conversation_participation p1
       *   JOIN conversation_participation p2
       *     ON p1.conversation_id = p2.conversation_id
       *    AND p1.party_pseudonym < p2.party_pseudonym
       *   JOIN conversation_seals cs ON cs.conversation_id = p1.conversation_id
       *   GROUP BY pseudonym_a, pseudonym_b
       */
      const edgeRows = await this.#readGraphEdges();

      const edgeUpsertValues: string[] = [];
      const edgeUpsertParams: unknown[] = [];
      let ei = 1;

      for (const edge of edgeRows) {
        edgeUpsertValues.push(`($${ei++}, $${ei++}, $${ei++}, now())`);
        edgeUpsertParams.push(edge.pseudonym_a, edge.pseudonym_b, parseInt(edge.edge_weight, 10));
      }

      if (edgeUpsertValues.length > 0) {
        await writeClient.query(
          `INSERT INTO conversation_graph_edges (pseudonym_a, pseudonym_b, edge_weight, computed_at)
           VALUES ${edgeUpsertValues.join(",")}
           ON CONFLICT (pseudonym_a, pseudonym_b) DO UPDATE SET
             edge_weight = EXCLUDED.edge_weight,
             computed_at = EXCLUDED.computed_at`,
          edgeUpsertParams,
        );
      }

      // DELETE stale edges — parameterized to match the safe pattern used for
      // pseudonym_stats and graph_analysis_results stale deletions above.
      if (edgeRows.length > 0) {
        const keepA = edgeRows.map((e) => e.pseudonym_a);
        const keepB = edgeRows.map((e) => e.pseudonym_b);
        await writeClient.query(
          `DELETE FROM conversation_graph_edges
           WHERE NOT EXISTS (
             SELECT 1 FROM UNNEST($1::text[], $2::text[]) AS keep(a, b)
             WHERE keep.a = conversation_graph_edges.pseudonym_a
               AND keep.b = conversation_graph_edges.pseudonym_b
           )`,
          [keepA, keepB],
        );
      } else {
        await writeClient.query(`DELETE FROM conversation_graph_edges`);
      }

      const edgeCount = edgeRows.length;

      // ─── Phase 3: graph_analysis_results ─────────────────────────────────
      currentPhase = "graph_analysis";

      /*
       * Compute graph metrics from the just-upserted edge table.
       *
       * Reads conversation_graph_edges from inside the write transaction so it sees
       * the freshly computed edges (not a stale previous run).
       *
       * Metrics computed in-memory (JavaScript) for simplicity at M4 single-node:
       *
       * clustering_coefficient(v):
       *   For node v with k neighbors: fraction of neighbor pairs that are also connected.
       *   Formula: (number of edges between neighbors of v) / (k * (k-1) / 2)
       *   For k < 2: clustering_coefficient = 0.
       *
       * community_id:
       *   Connected component assignment. Uses union-find.
       *   All nodes in the same connected component share a community_id.
       *   community_id is the minimum node ID (lexicographic) in the component.
       *   For isolated nodes (no edges): community_id is their own pseudonym index.
       *
       * conductance_score(v):
       *   Fraction of v's edges that cross community boundaries.
       *   = (edges from v to other communities) / (total edges of v)
       *   For isolated nodes: conductance_score = 0.
       */
      const edgesForAnalysis = await writeClient.query<EdgeRow>(
        "SELECT pseudonym_a, pseudonym_b, edge_weight FROM conversation_graph_edges",
      );

      const analysisResults = this.#computeGraphAnalysis(
        activePseudonyms,
        edgesForAnalysis.rows,
      );

      const analysisUpsertValues: string[] = [];
      const analysisUpsertParams: unknown[] = [];
      let ai = 1;

      for (const [pseudonym, metrics] of analysisResults) {
        analysisUpsertValues.push(`($${ai++}, $${ai++}, $${ai++}, $${ai++}, now())`);
        analysisUpsertParams.push(
          pseudonym,
          metrics.clusteringCoefficient,
          metrics.communityId,
          metrics.conductanceScore,
        );
      }

      if (analysisUpsertValues.length > 0) {
        await writeClient.query(
          `INSERT INTO graph_analysis_results
             (pseudonym, clustering_coefficient, community_id, conductance_score, computed_at)
           VALUES ${analysisUpsertValues.join(",")}
           ON CONFLICT (pseudonym) DO UPDATE SET
             clustering_coefficient = EXCLUDED.clustering_coefficient,
             community_id           = EXCLUDED.community_id,
             conductance_score      = EXCLUDED.conductance_score,
             computed_at            = EXCLUDED.computed_at`,
          analysisUpsertParams,
        );
      }

      // DELETE stale graph_analysis_results rows
      if (activePseudonyms.length > 0) {
        await writeClient.query(
          `DELETE FROM graph_analysis_results WHERE pseudonym != ALL($1)`,
          [activePseudonyms],
        );
      } else {
        await writeClient.query(`DELETE FROM graph_analysis_results`);
      }

      // ─── Record run in analytics_run_log ─────────────────────────────────
      await writeClient.query(
        `INSERT INTO analytics_run_log (run_id, last_run_at, pseudonym_count, edge_count)
         VALUES ($1, now(), $2, $3)`,
        [runId, pseudonymCount, edgeCount],
      );

      await writeClient.query("COMMIT");

      const durationMs = Date.now() - startMs;
      this.#logger.info("analytics.job.completed", {
        runId,
        durationMs,
        pseudonymCount,
        edgeCount,
      });
    } catch (err) {
      await writeClient.query("ROLLBACK").catch(() => {
        // Ignore rollback errors — original error is more important
      });

      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error(
        "analytics.job.failed",
        err instanceof Error ? err : new Error(reason),
        { runId, reason, phase: currentPhase },
      );
      throw err;
    } finally {
      writeClient.release();
    }
  }

  /**
   * Check whether the analytics job is stale (no successful run in > 24 hours).
   * Logs analytics.job.stale at WARN if stale.
   *
   * Reads analytics_run_log via the writePool (cello_service has SELECT on it).
   * Called periodically by the job scheduler.
   */
  async checkStale(): Promise<void> {
    const res = await this.#writePool.query<{ last_run_at: Date }>(
      "SELECT last_run_at FROM analytics_run_log ORDER BY last_run_at DESC LIMIT 1",
    );

    if (res.rows.length === 0) {
      // No run has ever completed — treat as stale from epoch
      this.#logger.warn("analytics.job.stale", { lastSuccessfulRunAt: null });
      return;
    }

    const lastSuccessfulRunAt = res.rows[0]!.last_run_at;
    const ageMs = Date.now() - lastSuccessfulRunAt.getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    if (ageMs > twentyFourHoursMs) {
      this.#logger.warn("analytics.job.stale", { lastSuccessfulRunAt });
    }
  }

  // ─── Private read helpers (use readPool — cello_analytics) ─────────────────

  /**
   * Read per-pseudonym stats from protocol tables.
   *
   * Uses the readPool (cello_analytics) — SELECT-only on protocol tables.
   * Returns one row per unique pseudonym.
   */
  async #readPseudonymStats(): Promise<PseudonymStatsRow[]> {
    const readClient = await this.#readPool.connect();
    try {
      const res = await readClient.query<PseudonymStatsRow>(
        `SELECT
           cp.party_pseudonym,
           COUNT(DISTINCT cp.conversation_id)::text AS conversation_count,
           (
             SELECT COUNT(DISTINCT cp2.party_pseudonym)
             FROM conversation_participation cp2
             WHERE cp2.conversation_id = ANY(
               ARRAY(SELECT cp3.conversation_id FROM conversation_participation cp3 WHERE cp3.party_pseudonym = cp.party_pseudonym)
             )
             AND cp2.party_pseudonym != cp.party_pseudonym
           )::text AS unique_counterparty_count,
           COUNT(CASE WHEN ca.attestation = 'CLEAN'   THEN 1 END)::text AS clean_count,
           COUNT(CASE WHEN ca.attestation = 'FLAGGED' THEN 1 END)::text AS flagged_count,
           MAX(cs.seal_date) AS last_activity
         FROM conversation_participation cp
         JOIN conversation_seals cs ON cs.conversation_id = cp.conversation_id
         LEFT JOIN conversation_attestations ca
           ON ca.conversation_id = cp.conversation_id
          AND ca.participant_pseudonym = cp.party_pseudonym
         GROUP BY cp.party_pseudonym`,
      );
      return res.rows;
    } finally {
      readClient.release();
    }
  }

  /**
   * Read graph edge data from protocol tables.
   *
   * Uses the readPool (cello_analytics) — SELECT-only.
   * Returns one row per unique (pseudonym_a, pseudonym_b) pair with pseudonym_a < pseudonym_b.
   */
  async #readGraphEdges(): Promise<EdgeRow[]> {
    const readClient = await this.#readPool.connect();
    try {
      const res = await readClient.query<EdgeRow>(
        `SELECT
           LEAST(p1.party_pseudonym, p2.party_pseudonym)    AS pseudonym_a,
           GREATEST(p1.party_pseudonym, p2.party_pseudonym) AS pseudonym_b,
           COUNT(DISTINCT p1.conversation_id)::text          AS edge_weight
         FROM conversation_participation p1
         JOIN conversation_participation p2
           ON p1.conversation_id = p2.conversation_id
          AND p1.party_pseudonym < p2.party_pseudonym
         JOIN conversation_seals cs ON cs.conversation_id = p1.conversation_id
         GROUP BY pseudonym_a, pseudonym_b`,
      );
      return res.rows;
    } finally {
      readClient.release();
    }
  }

  // ─── Graph analysis (in-memory computation) ───────────────────────────────

  /**
   * Compute graph analysis metrics for all pseudonyms.
   *
   * clustering_coefficient(v):
   *   For node v with k neighbors:
   *   cc = (edges among neighbors of v) / (k*(k-1)/2)
   *   cc = 0 if k < 2.
   *
   * community_id (connected components via union-find):
   *   All nodes in the same connected component share a community_id.
   *   community_id = stable integer index of the component's representative.
   *
   * conductance_score(v):
   *   = (edges from v to different communities) / (total weighted degree of v)
   *   = 0 for isolated nodes.
   */
  #computeGraphAnalysis(
    pseudonyms: string[],
    edges: EdgeRow[],
  ): Map<string, { clusteringCoefficient: number; communityId: number; conductanceScore: number }> {
    // Build adjacency structure
    // neighbors: pseudonym → Set<pseudonym> (unweighted)
    // weightedDegree: pseudonym → total edge_weight sum
    const neighbors = new Map<string, Set<string>>();
    const weightedDegree = new Map<string, number>();

    for (const p of pseudonyms) {
      neighbors.set(p, new Set());
      weightedDegree.set(p, 0);
    }

    for (const edge of edges) {
      const w = parseInt(edge.edge_weight, 10);

      if (!neighbors.has(edge.pseudonym_a)) {
        neighbors.set(edge.pseudonym_a, new Set());
        weightedDegree.set(edge.pseudonym_a, 0);
      }
      if (!neighbors.has(edge.pseudonym_b)) {
        neighbors.set(edge.pseudonym_b, new Set());
        weightedDegree.set(edge.pseudonym_b, 0);
      }

      neighbors.get(edge.pseudonym_a)!.add(edge.pseudonym_b);
      neighbors.get(edge.pseudonym_b)!.add(edge.pseudonym_a);
      weightedDegree.set(edge.pseudonym_a, (weightedDegree.get(edge.pseudonym_a) ?? 0) + w);
      weightedDegree.set(edge.pseudonym_b, (weightedDegree.get(edge.pseudonym_b) ?? 0) + w);
    }

    // Build edge lookup for neighbor-pair connectivity check
    const edgeSet = new Set<string>(
      edges.map((e) => `${e.pseudonym_a}|${e.pseudonym_b}`),
    );

    // Helper: check if two nodes are directly connected
    const connected = (a: string, b: string): boolean => {
      const [pa, pb] = a < b ? [a, b] : [b, a];
      return edgeSet.has(`${pa}|${pb}`);
    };

    // Union-find for connected components
    const parent = new Map<string, string>();
    const allNodes = new Set<string>([...pseudonyms, ...edges.flatMap((e) => [e.pseudonym_a, e.pseudonym_b])]);

    for (const node of allNodes) {
      parent.set(node, node);
    }

    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) !== root) {
        root = parent.get(root)!;
      }
      // Path compression
      let cur = x;
      while (cur !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };

    const union = (a: string, b: string): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) {
        // Use lexicographic minimum as canonical root
        if (ra < rb) {
          parent.set(rb, ra);
        } else {
          parent.set(ra, rb);
        }
      }
    };

    for (const edge of edges) {
      union(edge.pseudonym_a, edge.pseudonym_b);
    }

    // Assign stable integer community IDs from the set of roots
    const rootSet = new Set<string>();
    for (const node of allNodes) {
      rootSet.add(find(node));
    }
    const sortedRoots = [...rootSet].sort();
    const communityIdMap = new Map<string, number>(sortedRoots.map((root, idx) => [root, idx]));

    // Compute metrics for each pseudonym
    const results = new Map<string, { clusteringCoefficient: number; communityId: number; conductanceScore: number }>();

    for (const pseudonym of pseudonyms) {
      const nbrs = neighbors.get(pseudonym) ?? new Set();
      const k = nbrs.size;
      const myDegree = weightedDegree.get(pseudonym) ?? 0;

      // Clustering coefficient
      let clusteringCoefficient = 0;
      if (k >= 2) {
        const nbrArray = [...nbrs];
        let edgesAmongNeighbors = 0;
        for (let i = 0; i < nbrArray.length; i++) {
          for (let j = i + 1; j < nbrArray.length; j++) {
            if (connected(nbrArray[i]!, nbrArray[j]!)) {
              edgesAmongNeighbors++;
            }
          }
        }
        clusteringCoefficient = (2 * edgesAmongNeighbors) / (k * (k - 1));
      }

      // Community ID
      const root = find(pseudonym);
      const communityId = communityIdMap.get(root) ?? 0;

      // Conductance score: fraction of edges crossing community boundary (by weight)
      let crossCommunityWeight = 0;
      if (myDegree > 0) {
        for (const edge of edges) {
          if (edge.pseudonym_a === pseudonym || edge.pseudonym_b === pseudonym) {
            const other = edge.pseudonym_a === pseudonym ? edge.pseudonym_b : edge.pseudonym_a;
            if (find(other) !== root) {
              crossCommunityWeight += parseInt(edge.edge_weight, 10);
            }
          }
        }
        // conductance = cross-community weight / total degree
      }
      const conductanceScore = myDegree > 0 ? crossCommunityWeight / myDegree : 0;

      results.set(pseudonym, { clusteringCoefficient, communityId, conductanceScore });
    }

    return results;
  }
}
