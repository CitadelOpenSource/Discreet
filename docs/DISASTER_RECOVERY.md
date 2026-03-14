# Disaster Recovery Plan

This guide covers how to back up Discreet, how to restore it from scratch, and what to do when your infrastructure disappears. Written for the worst day of your ops life — follow it step by step.

---

## Recovery Targets

| Metric | Target | What It Means |
|--------|--------|---------------|
| **RTO** (Recovery Time Objective) | **4 hours** | From "it's down" to "it's back up and users can log in" — 4 hours max |
| **RPO** (Recovery Point Objective) | **1 hour** | You'll lose at most 1 hour of data. This means backups run at least hourly |

These targets assume you have followed the backup strategy below. If you haven't set up backups yet, **stop reading and go set them up now.**

---

## Backup Strategy

You need to back up three things: the database, your environment file, and Docker volumes (if applicable).

### 1. Database (PostgreSQL) — Hourly

The database is the most critical thing to back up. It contains all user accounts, server structures, channel metadata, and encrypted message blobs.

**Automated hourly backup script:**

Create this file at `/opt/discreet/backup.sh`:

```bash
#!/bin/bash
# Discreet automated backup script
# Run via cron every hour: 0 * * * * /opt/discreet/backup.sh

set -euo pipefail

BACKUP_DIR="/opt/discreet/backups/db"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/discreet_${TIMESTAMP}.sql.gz"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Dump the database, compress it
docker compose exec -T postgres pg_dump -U citadel -d citadel | gzip > "$BACKUP_FILE"

# Verify the backup isn't empty (common silent failure)
FILESIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE")
if [ "$FILESIZE" -lt 1000 ]; then
  echo "ERROR: Backup file is suspiciously small (${FILESIZE} bytes). Check PostgreSQL." >&2
  exit 1
fi

# Delete backups older than retention period
find "$BACKUP_DIR" -name "discreet_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "Backup complete: ${BACKUP_FILE} (${FILESIZE} bytes)"
```

**Set up the cron job:**

```bash
chmod +x /opt/discreet/backup.sh

# Open crontab editor
crontab -e

# Add this line (runs every hour on the hour):
0 * * * * /opt/discreet/backup.sh >> /var/log/discreet-backup.log 2>&1
```

**Verify it works:**

```bash
# Run it manually first
/opt/discreet/backup.sh

# Check the output
ls -la /opt/discreet/backups/db/

# You should see a file like: discreet_20260314_120000.sql.gz
# It should be at least a few KB (empty DB is ~5KB compressed)
```

### 2. Environment File (.env) — On every change

Your `.env` file contains secrets that cannot be regenerated (JWT_SECRET, TOTP_ENCRYPTION_KEY, AGENT_KEY_SECRET). If you lose these, all user sessions are invalidated and 2FA breaks.

```bash
# After any change to .env, copy it to your backup location
cp /opt/discreet/.env /opt/discreet/backups/env_backup_$(date +%Y%m%d).env

# ALSO: store a copy off-server
# Option A: Encrypted USB drive you keep physically secure
# Option B: Password manager (1Password, Bitwarden, KeePass)
# Option C: Encrypted file on a separate machine

# DO NOT store .env in:
# - Git (even private repos)
# - Unencrypted cloud storage
# - Email
# - Slack/Discord messages
```

### 3. Docker Volumes — Daily

If you're running with Docker Compose, your PostgreSQL data lives in a Docker volume.

```bash
# Find your volume name
docker volume ls | grep postgres
# Usually: discreet2_postgres_data or similar

# Back up the volume
docker run --rm \
  -v discreet2_postgres_data:/source:ro \
  -v /opt/discreet/backups/volumes:/backup \
  alpine tar czf /backup/postgres_volume_$(date +%Y%m%d).tar.gz -C /source .
```

### 4. Off-site backup (strongly recommended)

Local backups don't help if the whole machine dies. Copy backups off-server at least daily.

```bash
# Option A: rsync to another machine
rsync -avz /opt/discreet/backups/ user@backup-server:/backups/discreet/

# Option B: rclone to any cloud storage (S3, Backblaze B2, etc.)
# B2 has 10GB free tier
rclone sync /opt/discreet/backups/ b2:discreet-backups/

# Option C: scp to another machine you own
scp /opt/discreet/backups/db/latest.sql.gz user@other-machine:~/discreet-backups/
```

### Backup verification checklist

Run this monthly. A backup you haven't tested is not a backup.

```bash
# 1. Pick a recent backup
BACKUP="/opt/discreet/backups/db/discreet_20260314_120000.sql.gz"

# 2. Spin up a temporary PostgreSQL container
docker run -d --name pg_verify \
  -e POSTGRES_USER=citadel \
  -e POSTGRES_PASSWORD=verify_test \
  -e POSTGRES_DB=citadel \
  postgres:16

# 3. Wait for it to be ready
sleep 5

# 4. Restore the backup into it
gunzip -c "$BACKUP" | docker exec -i pg_verify psql -U citadel -d citadel

# 5. Verify data exists
docker exec pg_verify psql -U citadel -d citadel -c "SELECT COUNT(*) FROM users;"
# Should return a number matching your user count (approximately)

docker exec pg_verify psql -U citadel -d citadel -c "SELECT COUNT(*) FROM messages;"
# Should return a number that makes sense

# 6. Clean up
docker stop pg_verify && docker rm pg_verify

# 7. If steps 4-5 failed, YOUR BACKUPS ARE BROKEN. Fix them NOW.
```

---

## Restore Procedures

### Scenario A: Application crashed but server is fine

The simplest case. Your VM/machine is running, but the Discreet process died.

```bash
# 1. Check what's happening
docker compose ps            # Are containers running?
docker compose logs --tail 50 app  # What do the logs say?

# 2. Try restarting
docker compose restart

# 3. Verify
curl http://localhost:3000/health
# Should return 200

# 4. If health check fails, check PostgreSQL and Redis
docker compose exec postgres pg_isready
docker compose exec redis redis-cli ping
# PostgreSQL should say "accepting connections"
# Redis should say "PONG"

# 5. If the database or Redis won't start, see Scenario B
```

### Scenario B: Database corruption or data loss

Your server is running but the database is damaged or you need to restore from backup.

```bash
# 1. Stop the application (but keep PostgreSQL running)
docker compose stop app

# 2. Find your most recent backup
ls -lt /opt/discreet/backups/db/ | head -5
# Pick the most recent one that predates the corruption

# 3. Drop and recreate the database
docker compose exec postgres psql -U citadel -c "DROP DATABASE citadel;"
docker compose exec postgres psql -U citadel -c "CREATE DATABASE citadel OWNER citadel;"

# 4. Restore from backup
gunzip -c /opt/discreet/backups/db/discreet_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose exec -T postgres psql -U citadel -d citadel

# 5. Verify the restore
docker compose exec postgres psql -U citadel -d citadel -c "SELECT COUNT(*) FROM users;"

# 6. Start the application
docker compose start app

# 7. Verify everything
curl http://localhost:3000/health

# 8. Check Redis sessions — users will likely need to re-login
#    This is expected after a restore. Clear stale sessions:
docker compose exec redis redis-cli FLUSHDB

# 9. Notify users
#    "We restored from backup. You may need to log in again.
#     Messages from [time of backup] to [time of incident] may be missing
#     from the server, but your local client may still have them."
```

### Scenario C: Full server rebuild from scratch

Your entire machine is gone. You have backups (hopefully off-site) and need to rebuild everything.

```bash
# 1. PROVISION A NEW SERVER
#    Any Linux machine (Ubuntu 22.04+ recommended):
#    - 1 CPU, 1GB RAM minimum (Raspberry Pi works)
#    - Docker and Docker Compose installed
#    - SSH access

# 2. INSTALL DOCKER (if not already installed)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect

# 3. CLONE THE REPO
git clone https://github.com/anthropics/discreet2.git /opt/discreet
cd /opt/discreet

# 4. RESTORE YOUR .env FILE
#    Copy from your off-site backup (USB drive, password manager, etc.)
#    Put it at /opt/discreet/.env
#
#    CRITICAL: You must use the SAME secrets as before, especially:
#    - JWT_SECRET (or all sessions break)
#    - TOTP_ENCRYPTION_KEY (or all 2FA breaks)
#    - AGENT_KEY_SECRET (or all agent API keys break)
#
#    If you lost your .env and have no backup:
#    - Generate new secrets (see QUICKSTART.md)
#    - All users will need to re-login
#    - All users with 2FA will need to re-enroll
#    - All agent API keys will need to be re-entered
#    - This is painful but recoverable

# 5. START THE INFRASTRUCTURE
docker compose up -d

# 6. WAIT FOR POSTGRESQL TO BE READY
sleep 10
docker compose exec postgres pg_isready
# Must say "accepting connections" before continuing

# 7. RESTORE THE DATABASE
#    Copy your backup to the server first:
scp user@backup-server:/backups/discreet/db/latest.sql.gz /tmp/

#    Then restore:
gunzip -c /tmp/latest.sql.gz | \
  docker compose exec -T postgres psql -U citadel -d citadel

# 8. BUILD AND START THE APPLICATION
cd client-next && npm install && npm run build && cd ..
cargo build --release
# Or if using Docker: docker compose up -d app

# 9. VERIFY
curl http://localhost:3000/health
# Must return 200

# 10. UPDATE DNS (if IP changed — see DNS Failover section below)

# 11. CLEAR REDIS (stale sessions from old server)
docker compose exec redis redis-cli FLUSHDB

# 12. VERIFY END-TO-END
#     Open a browser, go to your domain, log in, send a test message.

# 13. RE-ENABLE BACKUPS
#     Copy backup.sh to the new server and set up cron (see Backup Strategy above)
```

### Scenario D: Restoring on a Raspberry Pi specifically

Same as Scenario C, but with Pi-specific notes:

```bash
# Use the ARM64 PostgreSQL image
# docker-compose.yml should already handle this, but verify:
docker compose exec postgres uname -m
# Should show "aarch64"

# If cargo build is too slow on the Pi (it will be), cross-compile:
# On your dev machine:
cross build --target aarch64-unknown-linux-gnu --release
scp target/aarch64-unknown-linux-gnu/release/discreet user@pi:/opt/discreet/

# Or pull a pre-built Docker image if available
# See DEPLOY_RASPBERRY_PI.md for Pi-specific guidance
```

---

## Oracle VM Recovery (if reclaimed)

Oracle Cloud's free tier VMs can be reclaimed with little warning. Here's what to do.

### Prevention

```bash
# Keep the VM "active" — Oracle reclaims idle instances
# Add a cron job that generates minimal CPU activity:
crontab -e

# Add this line (runs a trivial task every 6 hours):
0 */6 * * * /opt/discreet/backup.sh && curl -s http://localhost:3000/health > /dev/null
```

### When your VM is reclaimed

Don't panic. If you followed the backup strategy, you have everything you need.

```
Step 1: Accept that the VM is gone. You cannot get it back.

Step 2: Provision a new free-tier VM
   - Log into Oracle Cloud Console → Compute → Instances → Create Instance
   - Shape: VM.Standard.A1.Flex (ARM, up to 4 OCPU / 24GB RAM on free tier)
   - Image: Ubuntu 22.04 (or Oracle Linux)
   - Make sure to download/assign your SSH key

Step 3: Note the new public IP address
   - It WILL be different from before
   - You'll need to update DNS (see DNS Failover below)

Step 4: Follow "Scenario C: Full server rebuild from scratch" above

Step 5: Update DNS to point to the new IP (see below)

Step 6: Consider setting up off-site backups to survive this again
   - Your backups that were on the reclaimed VM are GONE
   - This is why off-site backups matter
```

### Oracle-specific tips

```bash
# Open required ports in Oracle's security list (they block by default)
# Console → Networking → Virtual Cloud Networks → your VCN → Security Lists

# Add ingress rules:
# Port 22   (SSH)
# Port 80   (HTTP)
# Port 443  (HTTPS)
# Port 3000 (Discreet, if not using a reverse proxy)

# Also open them in the VM's iptables/firewalld:
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

---

## DNS Failover Procedure

When your server's IP address changes (new VM, new provider, etc.), you need to update DNS records so your domain points to the new server.

### Step-by-step (any DNS provider)

```
1. GET YOUR NEW SERVER'S PUBLIC IP
   - Oracle Cloud: Console → Compute → Instances → your instance → Public IP
   - Any server: curl ifconfig.me

2. LOG INTO YOUR DNS PROVIDER
   (Cloudflare, Namecheap, Route53, etc.)

3. FIND YOUR DOMAIN'S DNS RECORDS
   Look for A records pointing to the OLD IP address.
   You'll typically have:
     Type: A    Name: @              Value: <old IP>
     Type: A    Name: www            Value: <old IP>
     (possibly others like api, meet, etc.)

4. UPDATE EACH A RECORD
   Change the Value/Content from the old IP to the new IP.
   Leave TTL as-is (or set to 300 / 5 minutes for faster propagation).

5. SAVE CHANGES

6. VERIFY PROPAGATION
   # Check from your machine
   nslookup yourdomain.com
   dig yourdomain.com

   # Or use an online tool: https://dnschecker.org
   # Enter your domain and check that the new IP shows up

7. WAIT FOR PROPAGATION
   - If TTL was 300 (5 min): should propagate within 5-15 minutes
   - If TTL was 3600 (1 hour): may take up to an hour
   - If TTL was 86400 (1 day): may take up to 24 hours
   - Cloudflare proxy (orange cloud): nearly instant

8. VERIFY END-TO-END
   # Once DNS has propagated:
   curl https://yourdomain.com/health
   # Should return 200
```

### Cloudflare-specific steps

If you use Cloudflare (recommended for free DDoS protection and fast DNS):

```
1. Log into Cloudflare dashboard
2. Select your domain
3. Go to DNS → Records
4. Click "Edit" on each A record
5. Update the IPv4 address to your new IP
6. Make sure the proxy status (orange cloud) is ON for HTTP traffic
7. Save
8. Changes take effect within 60 seconds through Cloudflare's proxy
```

### Reducing future DNS downtime

```bash
# Set a low TTL BEFORE you expect to migrate
# This way, when you do change the IP, propagation is fast

# In your DNS provider, set TTL to 60 or 300 for your A records
# Wait at least the old TTL duration before changing the IP
# After migration is stable, you can raise TTL back to 3600
```

---

## Quick Reference Card

Print this out and tape it next to your server. Seriously.

```
DISCREET DISASTER RECOVERY — QUICK REFERENCE

Backups location:   /opt/discreet/backups/
Off-site backups:   [FILL IN: where are your off-site copies?]
.env backup:        [FILL IN: where is your .env stored safely?]

DNS provider:       [FILL IN: Cloudflare / Namecheap / etc.]
DNS login:          [FILL IN: how to access]
Domain:             [FILL IN: yourdomain.com]

Oracle Cloud login: [FILL IN: how to access]
Server IP:          [FILL IN: current IP]
SSH key location:   [FILL IN: path to private key]

RESTORE FROM BACKUP:
  1. docker compose up -d
  2. gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U citadel -d citadel
  3. docker compose exec redis redis-cli FLUSHDB
  4. cargo build --release && cargo run (or docker compose up -d app)
  5. curl http://localhost:3000/health
  6. Update DNS if IP changed

EMERGENCY CONTACTS:
  Hosting provider support: [FILL IN]
  DNS provider support:     [FILL IN]
  Legal counsel:            [FILL IN]
```
