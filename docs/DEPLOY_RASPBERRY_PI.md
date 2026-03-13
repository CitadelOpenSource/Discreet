# DEPLOY ON RASPBERRY PI
## Self-Hosted E2EE Communication Server — $50 Hardware, $5/Year Electricity

Discreet runs on a Raspberry Pi 4 (4GB+) with an external SSD. Rust compiles natively to ARM64. The server draws ~5W idle, ~8W active — perfect for always-on encrypted communication that costs less than a cup of coffee per year to run.

---

## Requirements

### Hardware
- **Raspberry Pi 4** (4GB or 8GB RAM) — $55-75
- **External SSD** (128GB+) via USB 3.0 — $15-30 *(required — microSD is too slow for PostgreSQL)*
- **USB-C power supply** (5V 3A) — $10
- **Ethernet cable** recommended (WiFi works but slower)
- **MicroSD card** (32GB+) for boot only — $8

### Software
- **Raspberry Pi OS Lite 64-bit** (Bookworm) or **DietPi** (for maximum performance)
- **Docker** + **Docker Compose** (ARM64 compatible)
- **Rust 1.70+** (only if building from source on Pi; pre-built binaries recommended)

---

## Option A: Docker (Recommended — Easiest)

### 1. Flash OS
```bash
# Download Raspberry Pi Imager, flash Pi OS Lite 64-bit to microSD
# Enable SSH in Imager settings, set username/password
# Boot Pi, SSH in
```

### 2. Mount SSD
```bash
# Find the SSD
lsblk
# Format and mount (replace /dev/sda1 with your device)
sudo mkfs.ext4 /dev/sda1
sudo mkdir -p /mnt/ssd
sudo mount /dev/sda1 /mnt/ssd
echo '/dev/sda1 /mnt/ssd ext4 defaults,noatime 0 2' | sudo tee -a /etc/fstab
```

### 3. Install Docker
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in
```

### 4. Clone Discreet
```bash
cd /mnt/ssd
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
```

### 5. Configure Environment
```bash
cp .env.example .env
# Edit .env:
nano .env
```

Minimum `.env`:
```
DATABASE_URL=postgres://citadel:citadel@postgres:5432/citadel
REDIS_URL=redis://redis:6379
JWT_SECRET=<generate-with: openssl rand -hex 64>
HOST=0.0.0.0
PORT=3000
```

### 6. Start Everything
```bash
docker compose up -d
# Apply migrations
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel
done
```

### 7. Access
```bash
# From your local network:
# http://<pi-ip-address>:3000
# Find your Pi's IP:
hostname -I
```

---

## Option B: Native Build (Maximum Performance)

Building Rust natively on Pi is slow (~30-60 min for first build). For production, cross-compile on a faster machine.

### Cross-Compile on Desktop (Recommended)
```bash
# On your development machine (x86_64 Linux/macOS/WSL):
rustup target add aarch64-unknown-linux-gnu
sudo apt install gcc-aarch64-linux-gnu  # or equivalent for your OS

# Build
CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
  cargo build --release --target aarch64-unknown-linux-gnu

# Copy binary to Pi
scp target/aarch64-unknown-linux-gnu/release/citadel-server pi@<pi-ip>:/mnt/ssd/
```

### Build Natively on Pi
```bash
# Install Rust on Pi
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Build (will take 30-60 minutes on first build)
cd /mnt/ssd/Discreet
cargo build --release

# Run
./target/release/citadel-server
```

---

## Performance Notes

| Metric | Pi 4 (4GB) | Pi 4 (8GB) |
|--------|-----------|-----------|
| Concurrent users | 10-30 | 30-50 |
| Voice channels | 2-3 simultaneous | 4-6 simultaneous |
| Messages/second | ~100 | ~200 |
| Memory usage | ~400MB | ~400MB |
| Idle power | ~5W | ~5W |
| Active power | ~8W | ~8W |
| Annual electricity | ~$5-10 | ~$5-10 |

---

## Security Hardening

```bash
# Firewall — only expose port 3000
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 3000/tcp  # Discreet
sudo ufw enable

# SSH key-only auth (disable password)
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Auto-updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Remote Access (No Port Forwarding)

### Option 1: Tailscale (Recommended)
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Access via Tailscale IP from anywhere
```

### Option 2: Cloudflare Tunnel
```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x cloudflared-linux-arm64
./cloudflared-linux-arm64 tunnel --url http://localhost:3000
```

---

## Why Raspberry Pi?

- **$50 hardware** — cheaper than 1 month of cloud hosting
- **$5/year electricity** — always-on costs almost nothing
- **Physical control** — your server sits in your home/office
- **No cloud dependency** — works during internet outages (LAN)
- **Privacy by design** — your data never leaves your hardware
- **Perfect for**: activists, journalists, families, small teams, off-grid communities

*"Your own encrypted communication server. No corporation. No cloud. Just you."*
