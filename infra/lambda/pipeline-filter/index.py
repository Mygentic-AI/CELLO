import json
import boto3

codepipeline = boto3.client('codepipeline')

# Maps changed-file path prefixes to the CodePipeline(s) to trigger.
# Root config entries use exact filenames — they match files at the repo root.
# Package entries use directory prefixes — they match any file under that path.
FOLDER_MAPPINGS = [
    # ── existing cello-agent pipelines (unchanged) ─────────────────────────
    {
        'folder': 'frontend/',
        'pipelines': ['cello-frontend-staging-pipeline'],
        'description': 'Frontend',
    },
    {
        'folder': 'agent/',
        'pipelines': ['cello-backend-staging-pipeline', 'cello-graphiti-staging-pipeline'],
        'description': 'Backend + Graphiti',
    },
    # ── CELLO package pipelines (INFRA-001) ────────────────────────────────
    {
        'folder': 'packages/crypto/',
        'pipelines': ['cello-crypto-pipeline'],
        'description': 'crypto',
    },
    {
        'folder': 'packages/protocol-types/',
        'pipelines': ['cello-protocol-types-pipeline'],
        'description': 'protocol-types',
    },
    {
        'folder': 'packages/transport/',
        'pipelines': ['cello-transport-pipeline'],
        'description': 'transport',
    },
    {
        'folder': 'packages/client/',
        'pipelines': ['cello-client-pipeline'],
        'description': 'client',
    },
    {
        'folder': 'packages/adapter-claude-code/',
        'pipelines': ['cello-adapter-claude-code-pipeline'],
        'description': 'adapter-claude-code',
    },
    {
        'folder': 'packages/directory/',
        'pipelines': ['cello-directory-pipeline'],
        'description': 'directory',
    },
    {
        'folder': 'packages/relay/',
        'pipelines': ['cello-relay-pipeline'],
        'description': 'relay',
    },
    {
        'folder': 'packages/e2e-tests/',
        'pipelines': ['cello-e2e-tests-pipeline'],
        'description': 'e2e-tests',
    },
]

# Root config files that, when changed, trigger ALL 8 CELLO package pipelines.
# A change to tsconfig.base.json, pnpm-workspace.yaml, or root package.json
# could affect every package — all pipelines run.
# NOTE: frontend/ and agent/ entries in FOLDER_MAPPINGS are for the cello-agent repo
# (a separate GitHub repo, different project). Root config changes in CELLO do not
# affect cello-agent, so ALL_CELLO_PIPELINES intentionally excludes those pipelines.
ROOT_CONFIG_FILES = {'tsconfig.base.json', 'pnpm-workspace.yaml', 'package.json'}

ALL_CELLO_PIPELINES = [
    'cello-crypto-pipeline',
    'cello-protocol-types-pipeline',
    'cello-transport-pipeline',
    'cello-client-pipeline',
    'cello-adapter-claude-code-pipeline',
    'cello-directory-pipeline',
    'cello-relay-pipeline',
    'cello-e2e-tests-pipeline',
]


def lambda_handler(event, context):
    print(f"Received event: {json.dumps(event)}")

    # EventBridge passes the GitHub push payload as detail (may be a JSON string).
    detail_raw = event.get('detail', '{}')
    if isinstance(detail_raw, str):
        try:
            detail = json.loads(detail_raw)
        except json.JSONDecodeError:
            detail = {}
    else:
        detail = detail_raw

    print(f"Parsed detail: {json.dumps(detail)}")

    # Collect all changed file paths from every commit in the push.
    changed_files = []
    for commit in detail.get('commits', []):
        for field in ('modified', 'added', 'removed'):
            changed_files.extend(commit.get(field, []))

    print(f"Changed files: {changed_files}")

    # Root config check: any root config file triggers all 8 CELLO pipelines once.
    pipelines_to_trigger = set()
    for f in changed_files:
        if f in ROOT_CONFIG_FILES:
            print(f"Root config file changed ({f}) — triggering all CELLO pipelines")
            pipelines_to_trigger.update(ALL_CELLO_PIPELINES)
            break

    # Folder-prefix check: each matching prefix adds its pipelines to the set.
    for mapping in FOLDER_MAPPINGS:
        prefix = mapping['folder']
        matching = [f for f in changed_files if f.startswith(prefix)]
        if matching:
            print(f"Files in {prefix}: {matching} — adding {mapping['pipelines']}")
            pipelines_to_trigger.update(mapping['pipelines'])

    if not pipelines_to_trigger:
        print("No files match any pattern. No pipelines triggered.")
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'No matching files. No pipelines triggered.', 'changedFiles': changed_files}),
        }

    triggered = []
    for name in pipelines_to_trigger:
        try:
            resp = codepipeline.start_pipeline_execution(name=name)
            execution_id = resp['pipelineExecutionId']
            print(f"Started {name}: {execution_id}")
            triggered.append({'pipeline': name, 'executionId': execution_id})
        except Exception as e:
            # Log and continue — one pipeline failure must not block others.
            print(f"Error starting {name}: {e}")

    return {
        'statusCode': 200,
        'body': json.dumps({'message': f'Triggered {len(triggered)} pipeline(s)', 'pipelines': triggered}),
    }
