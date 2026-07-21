import pkg from '@whiskeysockets/baileys';
const { makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = pkg;
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import express from 'express'; // <-- Ditambahkan untuk membuka port HTTP Render

// ===== SETUP SERVER HTTP (AGAR RENDER TIDAK ERROR / PORT TERBUKA) =====
const app = express();
const port = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Bot WhatsApp is running and active!');
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 HTTP Server is listening on port ${port}`);
});

// ===== LOGIKA UTAMA BOT WHATSAPP =====
async function startBot() {
    // 1. Setup Sesi (Otomatis simpan di folder 'auth_info')
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false // Kita handle QR manual agar lebih stabil
    });

    sock.ev.on('creds.update', saveCreds);

    // 2. Event QR Code & Koneksi
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log("Scan QR Code di atas!");
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('[Start Up Bot Status]');
            console.log('✅ Bot sudah terhubung!');
            console.log('ID Bot:', sock.user.id);
            if (sock.user.lid) {
                console.log('LID Bot:', sock.user.lid);
            }
        }
    });
    
    // 3. Logika Pesan
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid.endsWith('@g.us')) return;
        
        // ===== CONFIG =====
        const COMMAND = "/Report/";
        const groupRoutes = {
            "628128044719-1434593507@g.us": ["120363423224364857@g.us", "6281511997009-1610335330@g.us"],
            "120363370213423911@g.us": ["120363423224364857@g.us"],
            "120363390341597440@g.us": ["120363390341597440@g.us"]
        };

        const targets = groupRoutes[remoteJid];
        if (!targets) return;

        console.log(`[${new Date().toLocaleString()}]`);
        console.log('Raw Message:', msg);

        // ===== LOGIKA DETEKSI =====
        const messageText = msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || "";
        const botLidClean = sock.user.lid ? sock.user.lid.split(':')[0] : "";

        // Cek tag berdasarkan LID yang muncul di teks atau metadata
        const isTagged = messageText.includes(`@${botLidClean}`);
        const hasCommand = messageText.includes(COMMAND);

        console.log(`[command: ${hasCommand}, tagged: ${isTagged}]`);

        if (!hasCommand || !isTagged) {
            return; // Bot diam jika tidak ada perintah/tag
        }
        
        console.log("Trigger detected! Processing...");

        // ===== CLEAN MESSAGE =====
        let cleanMessage = messageText.replace(COMMAND, '').replace(/@\S+/g, '').trim() + "\n\n🤖 Message Automated by Robot CAO";

        // ===== PROSES REPOST =====
        for (const target of targets) {
            try {
                if (msg.message.imageMessage || msg.message.videoMessage || msg.message.documentMessage) {
                    const type = msg.message.imageMessage ? 'image' : (msg.message.videoMessage ? 'video' : 'document');
                    const stream = await downloadContentFromMessage(msg.message[type + 'Message'], type);
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    
                    await sock.sendMessage(target, { [type]: buffer, caption: cleanMessage });
                } else {
                    await sock.sendMessage(target, { text: cleanMessage });
                }
                console.log(`Pesan diteruskan ke ${target}`);
            } catch (e) { 
                console.error(`Gagal meneruskan ke ${target}:`, e); 
            }
        }
        await sock.sendMessage(remoteJid, { text: '✅ Pesan berhasil diteruskan' }, { quoted: msg });
    });
}

startBot();