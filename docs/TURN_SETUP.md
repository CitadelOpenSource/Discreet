# TURN Server Setup (CoTURN on Ubuntu)

TURN relay servers allow WebRTC voice/video calls to work behind restrictive
NATs and firewalls. Without TURN, roughly 10-15% of users cannot connect
peer-to-peer and their calls will fail silently.

Discreet uses the CoTURN ephemeral credential mechanism (HMAC-SHA1 shared
secret). The Rust backend generates time-limited credentials per user; the
client fetches them before creating the RTCPeerConnection.

## Prerequisites

- Ubuntu 22.04+ (tested on Oracle Cloud ARM A1)
- A domain pointed to your server (e.g., `turn.discreetai.net`)
- Ports 3478, 5349, and 49152-65535 open
- The `TURN_SECRET` from your `.env` file

## Step-by-step

### 1. SSH into your server

```bash
ssh -i <path-to-your-ssh-key> ubuntu@<YOUR_SERVER_IP>
```

### 2. Install CoTURN

```bash
sudo apt-get update
sudo apt-get install -y coturn
```

### 3. Enable CoTURN as a system service

```bash
sudo systemctl enable coturn
```

Edit `/etc/default/coturn` and uncomment:

```
TURNSERVER_ENABLED=1
```

### 4. Configure CoTURN

Edit `/etc/turnserver.conf`:

```ini
# Network
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech

# Realm (must match TURN_REALM in .env)
realm=turn.discreetai.net

# Ephemeral credentials (must match TURN_SECRET in .env)
use-auth-secret
static-auth-secret=YOUR_TURN_SECRET_FROM_ENV

# TLS certificates (Let's Encrypt)
cert=/etc/letsencrypt/live/turn.discreetai.net/fullchain.pem
pkey=/etc/letsencrypt/live/turn.discreetai.net/privkey.pem

# Security
no-multicast-peers
no-stun-backward-compatibility
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255

# Port range for relay (must match firewall rules)
min-port=49152
max-port=65535

# Logging
log-file=/var/log/turnserver.log
simple-log
```

### 5. Get a TLS certificate

```bash
sudo certbot certonly --standalone -d turn.discreetai.net
```

Set up auto-renewal:

```bash
sudo certbot renew --deploy-hook "systemctl restart coturn"
```

### 6. Configure the firewall

```bash
sudo ufw allow 3478/udp    # TURN over UDP
sudo ufw allow 3478/tcp    # TURN over TCP
sudo ufw allow 5349/tcp    # TURNS (TLS)
sudo ufw allow 49152:65535/udp  # Relay port range
```

### 7. Oracle Cloud security list

In the Oracle Cloud console, add ingress rules for:

| Protocol | Port Range     | Source    |
|----------|---------------|-----------|
| UDP      | 3478          | 0.0.0.0/0 |
| TCP      | 3478          | 0.0.0.0/0 |
| TCP      | 5349          | 0.0.0.0/0 |
| UDP      | 49152-65535   | 0.0.0.0/0 |

### 8. DNS

Create an A record:

```
turn.discreetai.net → <YOUR_SERVER_IP>
```

**Important:** This must be DNS-only (gray cloud in Cloudflare), NOT proxied
(orange cloud). Cloudflare does not proxy UDP traffic.

### 9. Configure the Discreet backend

In your `.env` file:

```bash
TURN_SECRET=your_secret_here          # Must match static-auth-secret above
TURN_HOST=turn.discreetai.net         # Used to generate TURN URLs
# Or specify URLs explicitly:
# TURN_URLS=turn:turn.discreetai.net:3478?transport=udp,turn:turn.discreetai.net:3478?transport=tcp,turns:turn.discreetai.net:5349?transport=tcp
```

### 10. Start CoTURN

```bash
sudo systemctl restart coturn
sudo systemctl status coturn
```

### 11. Test

Open https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Add a server:
- URL: `turn:turn.discreetai.net:3478`
- Username: `1700000000:test` (any value for testing)
- Credential: generate with the HMAC-SHA1 of username using your secret

You should see `relay` candidates appear. If you only see `srflx` (server
reflexive), TURN is not working — check the coturn logs at
`/var/log/turnserver.log`.

## Troubleshooting

- **No relay candidates**: Check firewall rules, especially UDP 49152-65535
- **TLS errors**: Ensure certificate paths are correct and coturn can read them
- **Authentication failures**: Verify `static-auth-secret` matches `TURN_SECRET`
- **Oracle Cloud**: iptables rules may conflict with ufw; check `iptables -L`

## How it works

1. Client calls `GET /api/v1/voice/turn-credentials` (authenticated)
2. Backend generates: `username = "{expiry}:{user_id}"`, `credential = Base64(HMAC-SHA1(TURN_SECRET, username))`
3. Client creates `RTCPeerConnection` with the returned ICE servers
4. CoTURN validates credentials using the same shared secret
5. Credentials expire after 24 hours (configurable via `TURN_TTL`)
