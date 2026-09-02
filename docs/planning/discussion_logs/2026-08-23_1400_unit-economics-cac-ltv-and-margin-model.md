---
name: CELLO Unit Economics: CAC, LTV, Gross Margin, and Staffing Model
type: discussion
date: 2026-08-23
topics: [unit-economics, cac, ltv, gross-margin, gcp-infrastructure, staffing-model, churn, ai-first-ops]
status: active
description: >
  Authoritative unit economics model for CELLO based on actual August 2026 GCP billing,
  a 4-person 24/7 remote operational shift staffing model with AI-first playbook remediation,
  a 2% target monthly churn baseline, 80% long-term target gross margin, and organic CAC benchmarking
  against a fixed $10,000 monthly acquisition budget.
---

# 2026-08-23 - CELLO Unit Economics: CAC, LTV, Margin & Staffing Model

## Executive Summary

This log establishes the updated unit economics, infrastructure cost trajectory, operational staffing model, churn baselines, and CAC/LTV benchmarks for CELLO.

* **Current GCP Billing Ground Truth:** Verified August 2026 spend run rate is ~$707 over 23 days (~$30.74/day), consisting of **~$385 core protocol infrastructure** (`cello-infra`) and **~$322 Vertex AI Gemini model inference & voice pipelines**.
* **Idle Infrastructure Floor:** Core multi-region protocol baseline (3 Directory nodes, 2 Relay nodes with WAL disks, 4 Cloud SQL Postgres instances) runs at **~$500 / month** at 0 active users.
* **Target Churn Baseline:** **2.0% monthly churn** (~21.5% annual), representing defensible post-integration retention for B2B developer/agent trust infrastructure.
* **Long-Term Gross Margin Target:** **80%+**, achieved when user scale amortizes the fixed operational shift team.
* **Customer Lifetime Value (LTV):** **$400.00** at $10 Average ARPU (80% margin, 2% churn) and **$600.00** at $15 ARPU.
* **Organic Acquisition Target (3:1 LTV:CAC on $10k Budget):** Requires **75 new customers/month** at $10 ARPU ($133 CAC) or **50 new customers/month** at $15 ARPU ($200 CAC).

---

## 1. Ground Truth Infrastructure Costs (`cello-infra`)

### Actual August 2026 Spend Breakdown
Querying billing account `012EFA-590A2E-2A82B4` verified total 23-day August spend at **$707.00**:

| Component / Project | 23-Day Cost | Monthly Run-Rate | % of Total | Operational Function |
| :--- | ---:| ---:| ---:| :--- |
| **`cello-infra`** | $385.00 | ~$500.00 | 54.5% | Core multi-region protocol infrastructure |
| **`gen-lang-client-0809834273`** | $240.00 | ~$313.00 | 34.0% | Gemini / Vertex AI model inference |
| **`mygentic-voice-agent` + `sdk`** | $82.00 | ~$107.00 | 11.5% | Voice synthesis & agentic execution runs |
| **Total** | **$707.00** | **~$920.00** | **100%** | Combined operational spend |

### Pure Protocol Infrastructure Scaling Schedule (Excluding Personnel)
Adding Cloud Armor WAF and Global Load Balancing adds a flat **+$25.00 to $40.00 / month** edge hardening overhead:

| Active Users | Core Infra Cost | Hardening Cost | Total Pure Infra | **Pure Infra / 1k Users** | Pure Infra Margin ($15 ARPU) |
|---:|---:|---:|---:|---:|---:|
| **1,000** | $500.00 | $25.00 | $525.00 | **$525.00** | 96.5% |
| **5,000** | $900.00 | $30.00 | $930.00 | **$186.00** | 98.8% |
| **10,000** | $1,500.00 | $35.00 | $1,535.00 | **$153.50** | 99.0% |
| **20,000** | $2,400.00 | $40.00 | $2,440.00 | **$122.00** | 99.2% |

*Marginal pure infrastructure cost per active user scales down to **~$0.12 to $0.15 / month** at target scale.*

---

## 2. Operational Staffing Model (AI-First Ops & 24/7 Shift Team)

### Shift Architecture & Compensation Structure
Operations leverage proactive AI monitoring and self-healing runtime playbooks to resolve >95% of routine incidents. For human oversight, security approvals, and edge-case escalation, a remote 4-person 24/7 shift team is defined:

* **3 Senior SRE / Systems Engineers:** $120,000/yr ($10,000/mo x 3 = **$30,000/mo**): 8-hour rotating shift coverage.
* **1 Junior Engineer:** $84,000/yr ($7,000/mo x 1 = **$7,000/mo**): off-peak and weekend support.
* **Full Fixed Shift Personnel Budget:** **$37,000 / month** ($444,000 / year).

### Phased Hiring Triggers
Staffing is phased in step-wise as user volume grows:

| Scale Tier | Staffing Structure | Monthly Staff Cost | Gross Revenue ($15 ARPU) | Gross Margin ($) | **Gross Margin (%)** |
|---:|:--- |---:|---:|---:|---:|
| **0 to 999** | 0 Ops (Founders) | $0 | $15,000 | $14,475 | **96.5%** |
| **1,000** | 1 Senior Engineer | $10,000 | $15,000 | $4,475 | **29.8%** |
| **1,500** | 1 Senior Engineer | $10,000 | $22,500 | $11,945 | **53.1%** |
| **2,500** | 2 Senior Engineers | $20,000 | $37,500 | $16,800 | **44.8%** |
| **5,000** | 3 Senior Engineers | $30,000 | $75,000 | $44,070 | **58.8%** |
| **10,000** | Full 4-Person Team | $37,000 | $150,000 | $111,465 | **74.3%** |
| **12,500** | Full 4-Person Team | $37,000 | $187,500 | $148,700 | **79.3% → 80.0%** |
| **20,000** | Full 4-Person Team | $37,000 | $300,000 | $260,560 | **86.9%** |

---

## 3. Gross Margin & Retention Targets

### Gross Margin Trajectory
* At $15 ARPU, 80% gross margin is achieved at **~12,500 active users** ($187,500 monthly revenue vs $38,800 total direct costs).
* At $10 Average ARPU, 80% gross margin is achieved at **~20,000 active users** ($200,000 monthly revenue vs $39,440 total direct costs).

### Churn & LTV Benchmarking
* **Target Churn:** **2.0% monthly churn** (~21.5% annual churn, ~50-month customer lifetime).
* **Defensibility:** While early self-serve sandbox accounts may churn at 3.5% to 5.0% during trial/PoC phases, production core workflows integrated into agent rosters and non-repudiable logs maintain <2.0% monthly churn.

### Customer Lifetime Value (LTV) at 80% Gross Margin & 2% Churn
$$\text{LTV} = \frac{\text{ARPU} \times \text{Gross Margin}}{\text{Monthly Churn}}$$

* **At $10 Average ARPU:** $\text{LTV} = \frac{\$10 \times 0.80}{0.02} = \mathbf{\$400.00}$
* **At $15 ARPU:** $\text{LTV} = \frac{\$15 \times 0.80}{0.02} = \mathbf{\$600.00}$

---

## 4. CAC & LTV:CAC Matrix ($10,000 Monthly Organic Budget)

CAC is modeled against a fixed **$10,000 / month organic content acquisition budget**:

$$\text{Upfront CAC} = \frac{\$10,000}{\text{New Customers Acquired / Month}}$$

| New Customers Acquired / Month | Upfront CAC | LTV:CAC Ratio ($10 ARPU / $400 LTV) | LTV:CAC Ratio ($15 ARPU / $600 LTV) |
|---:|---:|---:|---:|
| **25** | $400.00 | 1.00x | 1.50x |
| **50** | $200.00 | 2.00x | **3.00x** *(Benchmark)* |
| **75** | $133.33 | **3.00x** *(Benchmark)* | 4.50x |
| **100** | $100.00 | 4.00x | 6.00x |
| **125** | $80.00 | 5.00x | 7.50x |
| **200** | $50.00 | 8.00x | 12.00x |
| **250** | $40.00 | 10.00x | 15.00x |

### Acquisition Volume Milestones for 3:1 LTV:CAC
* **At $10 Average ARPU ($400 LTV):** Requires acquiring **75 new customers / month** (target CAC = $133.33).
* **At $15 ARPU ($600 LTV):** Requires acquiring **50 new customers / month** (target CAC = $200.00).
