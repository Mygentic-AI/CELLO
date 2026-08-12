---
name: obs-footage-uploader
description: Upload local OBS recordings and metadata to the remote Hermes EC2 instance for video assembly, transcription, and Remotion rendering.
---

# OBS Footage Uploader (Local to Cloud)

Use this command when the user records video clips locally (e.g., in OBS) and wants to upload them to the remote Hermes EC2 instance (`54.234.44.162`) for assembly, transcription, and rendering via Remotion.

## SSH & Host Access

- **Target Host:** `54.234.44.162` (`ubuntu` user)
- **SSH Key:** `~/.ssh/cello-hermes-key.pem`
- **Destination Folder:** `/home/ubuntu/raw_footage/`

If you encounter an SSH connection timeout, check if your local IP is allowlisted on the EC2 security group:

```bash
MYIP=$(curl -s https://checkip.amazonaws.com) && aws ec2 authorize-security-group-ingress \
  --region us-east-1 --group-id sg-0ecea6e6030d0d4b7 --protocol tcp --port 22 --cidr "$MYIP/32"
```

## Step 1: Prepare the Metadata JSON

Before uploading, generate a metadata JSON file alongside the local video file. This helps the remote cloud agent understand how to align and stitch the footage into the Remotion timeline.

Write a JSON file (e.g., `2026-08-11_17-13-50_meta.json`) in the same local directory as the video file:

```json
{
  "filename": "2026-08-11_17-13-50.mp4",
  "segment_id": 1,
  "type": "talking-head",
  "script_reference": "Building Cello in public - raw recording for episode setup",
  "notes": "Good take, use this for the hook."
}
```

## Step 2: Ensure Remote Directory Exists

Before executing `rsync`, verify or create the target directory on the EC2 instance:

```bash
ssh -o StrictHostKeyChecking=no -i ~/.ssh/cello-hermes-key.pem ubuntu@54.234.44.162 "mkdir -p /home/ubuntu/raw_footage"
```

## Step 3: Upload via Rsync

Use `rsync` with the specified SSH identity key to transfer both the video file and the metadata JSON to the EC2 box:

```bash
rsync -avP -e "ssh -o StrictHostKeyChecking=no -i ~/.ssh/cello-hermes-key.pem" \
  /path/to/local/video.mp4 /path/to/local/video_meta.json \
  ubuntu@54.234.44.162:/home/ubuntu/raw_footage/
```

## Step 4: Handoff Confirmation

Once the transfer finishes successfully, inform the user:

"Upload complete. You can now switch to your cloud Hermes chat and tell it: 'I've uploaded the footage for Segment 1 to the raw_footage folder, please align and process it.'"
