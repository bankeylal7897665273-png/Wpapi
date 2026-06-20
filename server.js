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

const PORT = process.env.PORT || 7860;
const UNIQUE_ID = 'unekid'; // Aapka diya hua unique ID

let sock;
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Silent to avoid Hugging Face log spam
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
                console.log('Logged out from WhatsApp. Please link again.');
                // Delete auth folder if logged out so it can restart fresh
                fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
            }
        } else if (connection === 'open') {
            isConnected = true;
            console.log('WhatsApp Connected Successfully!');
        }
    });
}

// Start connection on boot
connectToWhatsApp();

// API to request 8-digit code
app.post('/request-code', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    try {
        if (!sock.authState.creds.me) {
            // Remove '+' and spaces
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            // Requesting pairing code
            const code = await sock.requestPairingCode(cleanNumber);
            // Format code as XXXX-XXXX for readability
            const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
            res.json({ code: formattedCode });
        } else {
            res.json({ error: 'Device is already connected' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API to check connection status
app.get('/status', (req, res) => {
    res.json({ connected: isConnected });
});

// Main API Route matching your requirement:
// /api/unekid/+910000000000=OTP=8483
app.get('/api/:uniqueid/:payload', async (req, res) => {
    const { uniqueid, payload } = req.params;

    if (uniqueid !== UNIQUE_ID) {
        return res.status(403).json({ success: false, error: 'Invalid Unique ID' });
    }

    // Split the payload by '=OTP=' (or fallback to '=sms=' just in case)
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
        // WhatsApp format for direct messages: number@s.whatsapp.net
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
