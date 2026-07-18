import WebSocket from 'ws';
import settings from './settings.json' with { type: "json" };

const { GATEWAY_URL, TOKEN, DEBUG } = settings;

function debugLog(message: string) {
    if (DEBUG) {
        console.log(`[DEBUG] ${message}`);
    }
}

class DiscordClient {
    private token: string;
    private ws: WebSocket | null = null;
    private heartbeatInterval: number | null = null;
    private lastHeartbeatAck: boolean = true;
    private sequence: number | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;

    constructor(token: string) {
        this.token = token;
    }

    async connect(): Promise<void> {
        try {
            this.ws = new WebSocket(GATEWAY_URL);

            this.ws.on('open', () => {
                console.log("[+] Connected to Discord Gateway (JSON Mode)");
            });

            this.ws.on('message', async (message: WebSocket.Data) => {
                try {
                    const payloadString = message.toString();
                    debugLog(`Received ${payloadString.length} bytes`);
                    
                    const data = JSON.parse(payloadString);
                    await this.handleMessage(data);
                } catch (e) {
                    console.error(`[-] Decode error: ${e}`);
                    this.ws?.close();
                }
            });

            this.ws.on('error', (e) => {
                console.error(`[-] Connection error: ${e.message}`);
            });

            await new Promise<void>((resolve) => {
                this.ws?.on('close', () => {
                    console.log("[-] Connection closed. Cleaning up...");
                    this.cleanup();
                    resolve();
                });
            });

        } catch (e) {
            console.error(`[-] Connection error: ${e}`);
            this.cleanup();
        }
    }

    async identify(): Promise<void> {
        console.log("[*] Identifying with Discord...");
        const payload = {
            "op": 2,
            "d": {
                "token": this.token,
                "capabilities": 8193,
                "properties": {
                    "os": "android",
                    "browser": "Discord VR",
                    "device": "oculus",
                },
                "presence": {
                    "status": "online",
                    "activities": [], // Etkinlik listesi boş, yazı çıkmaz
                    "afk": false
                },
                "compress": false
            }
        };
        await this.sendJson(payload);
    }

    private startHeartbeat(): void {
        if (!this.heartbeatInterval) return;

        this.heartbeatTimer = setInterval(async () => {
            if (!this.lastHeartbeatAck) {
                console.error("[-] No ACK, disconnecting...");
                this.ws?.close();
                return;
            }

            const heartbeat = {
                "op": 1,
                "d": this.sequence
            };
            
            this.lastHeartbeatAck = false;
            await this.sendJson(heartbeat);
            console.log("[*] Heartbeat sent");
        }, this.heartbeatInterval);
    }

    async sendJson(data: any): Promise<void> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    async handleMessage(data: any): Promise<void> {
        const op = data.op;
        const t = data.t;
        const s = data.s;
        const d = data.d;

        if (s !== undefined && s !== null) {
            this.sequence = s;
        }

        if (op === 10) {
            this.heartbeatInterval = d.heartbeat_interval;
            console.log("[+] Hello received, starting heartbeat...");
            await this.startHeartbeat();
            await this.identify(); // Bağlantı için identify çağrısı aktif edildi
        } 
        else if (op === 11) {
            this.lastHeartbeatAck = true;
            console.log("[*] Heartbeat ACK");
        } 
        else if (t === "READY") {
            console.log(`[+] Logged in as ${d.user.username}`);
            
            // Buradaki presence güncellemesinden de activity kaldırıldı
            await this.sendJson({
                "op": 3,
                "d": {
                    "since": 0,
                    "activities": [], 
                    "status": "online",
                    "afk": false
                }
            });
            console.log("[+] Presence updated (No Activity)");
            
            await this.sendJson({
                "op": 4,
                "d": {
                    "guild_id": "1522893481444642957",
                    "channel_id": "1524544550222172180",
                    "self_mute": true,
                    "self_deaf": true
                }
            });
            console.log("[+] Voice channel join intent sent");
        }
    }

    private cleanup(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}

async function main() {
    while (true) {
        console.log("\n[*] Starting connection attempt...");
        const client = new DiscordClient(TOKEN);
        await client.connect();
        
        console.log("[*] Waiting 5 seconds before reconnecting...");
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

if (require.main === module) {
    main().catch(console.error);
}