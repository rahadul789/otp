# Foodbela VPS Docker Deployment

এই setup-এ app + monitoring stack চলবে:

- `backend`: Express/Socket.IO API, Docker network-এর ভিতরে port `5000`।
- `restaurant-owner-web`: nginx দিয়ে React build serve করে, public port `80` expose করে।
- `prometheus`: backend/Grafana/Loki/Alloy metrics scrape করে store করবে।
- `grafana`: dashboard UI।
- `loki`: application/container logs store করবে।
- `alloy`: Docker container logs collect করে Loki-তে পাঠাবে, এবং নিজের metrics expose করবে।

MongoDB VPS-এ চলবে না। Backend সরাসরি MongoDB Atlas-এ connect করবে।

Browser থেকে request flow:

```text
User browser -> VPS port 80 -> restaurant-owner-web nginx
nginx /api/* -> backend:5000
nginx /socket.io/* -> backend:5000
backend -> MongoDB Atlas
prometheus -> backend:5000/metrics
alloy -> docker logs -> loki
grafana -> prometheus + loki
```

## 1. VPS-এ Docker install

Ubuntu VPS হলে:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

বর্তমান user দিয়ে Docker চালাতে চাইলে:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

## 2. Firewall port খুলে দাও

Ubuntu firewall ব্যবহার করলে:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

এই setup-এ backend port `5000` public করা লাগবে না। nginx container public request নেবে, তারপর Docker network-এর ভিতরে backend-এ পাঠাবে।

## 3. Atlas network access ঠিক করো

MongoDB Atlas dashboard-এ গিয়ে:

```text
Network Access -> Add IP Address -> VPS public IP
```

শুধু test করার জন্য `0.0.0.0/0` ব্যবহার করা যায়, কিন্তু production-এর জন্য VPS public IP allowlist করা ভালো।

Atlas connection string এমন হবে:

```env
MONGODB_URI=mongodb+srv://ATLAS_USERNAME:ATLAS_PASSWORD@ATLAS_CLUSTER_HOST/foodbela?retryWrites=true&w=majority
```

Username/password-এ special character থাকলে URL-encode করতে হবে। যেমন `@` হলে `%40`।

## 4. Project VPS-এ নাও

Git repo থাকলে:

```bash
sudo apt install -y git
git clone https://github.com/rahadul789/otp.git foodbela
cd foodbela
```

Git না থাকলে local machine থেকে upload:

```bash
scp -r ./upload root@YOUR_VPS_IP:/opt/foodbela
ssh root@YOUR_VPS_IP
cd /opt/foodbela
```

## 5. Production env তৈরি করো

```bash
cp .env.example .env
nano .env
```

Strong secret বানানোর জন্য:

```bash
openssl rand -hex 32
```

এই values অবশ্যই বদলাবে:

- `MONGODB_URI`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `GRAFANA_ADMIN_PASSWORD`
- `CLIENT_ORIGIN`, `ADMIN_PANEL_ORIGIN`, `CUSTOMER_APP`, `DELIVERY_APP`, `BACKEND_PUBLIC_URL`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

প্রথম deploy-তে domain না থাকলে origin values এমন হতে পারে:

```env
CLIENT_ORIGIN=http://YOUR_VPS_IP
ADMIN_PANEL_ORIGIN=http://YOUR_VPS_IP
CUSTOMER_APP=http://YOUR_VPS_IP
DELIVERY_APP=http://YOUR_VPS_IP
BACKEND_PUBLIC_URL=http://YOUR_VPS_IP
```

Domain/SSL করার পর এগুলো `https://your-domain.com` করে দেবে।

## 6. Container build এবং start

```bash
docker compose up -d --build
```

Status দেখো:

```bash
docker compose ps
```

Logs দেখো:

```bash
docker compose logs -f backend
docker compose logs -f restaurant-owner-web
docker compose logs -f prometheus
docker compose logs -f grafana
docker compose logs -f loki
docker compose logs -f alloy
```

## 7. Health check

VPS-এর ভিতর থেকে:

```bash
curl http://localhost/api/v1/health
curl http://localhost/api/v1/health/ready
docker compose exec backend wget -qO- http://127.0.0.1:5000/metrics | head
```

Browser থেকে:

```text
http://YOUR_VPS_IP
http://YOUR_VPS_IP/api/v1/health
```

`ready` response-এ database `connected` হলে backend Atlas-এর সাথে ঠিকভাবে connect করেছে।

## 8. Monitoring dashboard দেখো

Defaultভাবে monitoring ports শুধু VPS-এর localhost-এ bind করা আছে:

```env
MONITORING_BIND_ADDRESS=127.0.0.1
```

এটা production-এর জন্য ভালো default, কারণ Grafana/Prometheus/Loki public internet-এ খোলা থাকে না।

তোমার local computer থেকে SSH tunnel করো:

```bash
ssh -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 -L 3100:127.0.0.1:3100 -L 12345:127.0.0.1:12345 root@YOUR_VPS_IP
```

তারপর browser-এ:

```text
Grafana:    http://localhost:3000
Prometheus: http://localhost:9090
Loki:       http://localhost:3100/ready
Alloy:      http://localhost:12345
```

Grafana login:

```text
username: .env-এর GRAFANA_ADMIN_USER
password: .env-এর GRAFANA_ADMIN_PASSWORD
```

Grafana dashboard:

```text
Dashboards -> Foodbela -> Foodbela Backend Overview
```

## 9. Production note

Grafana/Prometheus/Loki single-node Docker Compose setup ছোট VPS বা early production monitoring-এর জন্য practical। High traffic production হলে আলাদা monitoring server, persistent backup, alerting, auth/reverse-proxy, retention sizing, এবং Grafana Alloy/OpenTelemetry collector ব্যবহার করা ভালো।

## 10. Update deploy

নতুন code pull/upload করার পর:

```bash
docker compose up -d --build --remove-orphans
docker image prune -f
```

## 11. Backup

Atlas database backup Atlas dashboard থেকে নিতে পারো:

```text
Atlas -> Backup / Snapshots
```

Free/shared cluster হলে `mongodump` local/VPS থেকেও চালানো যায়, তবে আগে MongoDB Database Tools install করতে হবে।

Monitoring data Docker volumes-এ থাকবে:

```bash
docker volume ls | grep foodbela
```

## 12. Useful commands

Restart:

```bash
docker compose restart
```

Stop:

```bash
docker compose down
```

Backend logs:

```bash
docker compose logs -f backend
```

Frontend/nginx logs:

```bash
docker compose logs -f restaurant-owner-web
```

Monitoring logs:

```bash
docker compose logs -f prometheus grafana loki alloy
```
