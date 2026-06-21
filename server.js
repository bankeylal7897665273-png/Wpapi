const crypto = require('crypto');
if (!global.crypto) {
    global.crypto = crypto.webcrypto;
}

const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serving the HTML file from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Render.com automatically assigns a PORT
const PORT = process.env.PORT || 8080;

// Aapka Unique ID, jo dynamically update hoga aur save rahega
let UNIQUE_ID = 'unekid'; 
const idFilePath = path.join(__dirname, 'custom_id.txt');

// Server start hote hi check karega ki koi custom ID save hai ya nahi
if (fs.existsSync(idFilePath)) {
    UNIQUE_ID = fs.readFileSync(idFilePath, 'utf8').trim();
}

let sock;
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Silent to avoid log spam
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isConnected = false;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Logged out from WhatsApp.');
                if (fs.existsSync('./auth_info_baileys')) {
                    fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
                }
            }
        } else if (connection === 'open') {
            isConnected = true;
            console.log('WhatsApp Connected Successfully!');
        }
    });
}

// Start connection on boot
connectToWhatsApp();

// Naya API: Purane Session ko Reset karne ke liye
app.post('/reset', async (req, res) => {
    try {
        isConnected = false;
        if (sock) {
            sock.ev.removeAllListeners();
            try { await sock.logout(); } catch (e) {}
        }
        // Force delete the old session folder
        if (fs.existsSync('./auth_info_baileys')) {
            fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
        }
        // Start fresh
        connectToWhatsApp();
        res.json({ success: true, message: 'Server Memory Cleared. You can request a new code now.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API to request 8-digit code
app.post('/request-code', async (req, res) => {
    const { phoneNumber, customId } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    if (customId && customId.trim() !== '') {
        UNIQUE_ID = customId.trim();
        fs.writeFileSync(idFilePath, UNIQUE_ID);
    }

    try {
        // Checking if already connected
        if (sock && sock.authState && sock.authState.creds && sock.authState.creds.me) {
             return res.json({ error: 'Device is already connected! Please click "Reset Server" below to clear old data.' });
        }

        // Clean number (removes + and spaces automatically)
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        // Wait briefly to ensure socket is ready
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Requesting pairing code
        const code = await sock.requestPairingCode(cleanNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        res.json({ code: formattedCode });
        
    } catch (err) {
        res.status(500).json({ error: 'System processing... Click Get Code again in 5 seconds. (' + err.message + ')' });
    }
});

// API to check connection status
app.get('/status', (req, res) => {
    res.json({ connected: isConnected, finalId: UNIQUE_ID });
});

// Main API Route matching your requirement:
// /api/unekid/+910000000000=OTP=8483
app.get('/api/:uniqueid/:payload', async (req, res) => {
    const { uniqueid, payload } = req.params;

    if (uniqueid !== UNIQUE_ID) {
        return res.status(403).json({ success: false, error: 'Invalid Unique ID' });
    }

    let parts = payload.split('=OTP=');
    if (parts.length !== 2) {
        parts = payload.split('=sms=');
    }
    
    if (parts.length !== 2) {
        return res.status(400).json({ success: false, error: 'Invalid format. Use number=OTP=message' });
    }

    const targetNumber = parts[0].replace(/[^0-9]/g, '');
    const messageText = parts[1];

    if (!isConnected) {
        return res.status(500).json({ success: false, error: 'WhatsApp is not connected to the server yet.' });
    }

    try {
        const jid = targetNumber + '@s.whatsapp.net';
        await sock.sendMessage(jid, { text: messageText });
        
        res.json({ success: true, message: `Sent success to ${targetNumber}` });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
