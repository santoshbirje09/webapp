const express = require('express');
const { Client, LocalAuth,Buttons } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');  // File system module for logging
const bodyParser = require('body-parser');
const session = require('express-session'); // For managing sessions
const path = require('path');


// Initialize express app
const app = express();
const port = 3000;
const apiKey = process.env.API_KEY;

app.use(bodyParser.json()); // Parse JSON request bodies
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded request bodies

// Setup session for login
app.use(session({
    secret: 'mysecret', // Change to a secure, random value
    resave: false,
    saveUninitialized: true
}));

// Dummy username and password (replace with real authentication logic)
const validUsername = process.env.USER_NAME;
const validPassword = process.env.PASSWORD;

let qrCodeData = null;  // Variable to store the QR code data
let isClientReady = false;  // Track if the client is ready

// Create a new client instance with LocalAuth for session persistence
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Add no-sandbox arguments here
    }
});

// Event listener when client is ready
client.on('ready', () => {
    const readyMessage = 'WhatsApp client is ready!';
    console.log(readyMessage);
    isClientReady = true;  // Mark client as ready
    qrCodeData = null;  // Clear QR code as it's no longer needed
});

// Event listener for QR code generation
client.on('qr', (qr) => {
    console.log('QR code received, generating image...');

    // Convert QR string to a base64 data URL to serve in the browser
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.log('Failed to generate QR code:', err);
        } else {
            qrCodeData = url;  // Store the generated QR code image
        }
    });
});

// Event listener for disconnection
client.on('disconnected', () => {
    const disconnectMessage = 'WhatsApp client disconnected!';
    console.log(disconnectMessage);
    isClientReady = false;  // Client is no longer ready
    qrCodeData = null;  // Clear QR code data
});

// Start the WhatsApp client
client.initialize();

// Middleware to verify API key
function verifyApiKey(req, res, next) {
    const userApiKey = req.headers['x-api-key'];
    if (userApiKey && userApiKey === apiKey) {
        next();
    } else {
        res.status(403).json({ status: 'error', message: 'Invalid API key' });
    }
}

// Function to wait for client readiness
async function waitForClientReady(retries, delay) {
    while (!isClientReady && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        retries--;
    }
    if (!isClientReady) {
        throw new Error('Client is not ready');
    }
}

// Root-level login page (GET request)
app.get('/', (req, res) => {
    res.send(`
        <html>
            <body>
                <h1>Login</h1>
                <form action="/" method="POST">
                    <label for="username">Username:</label>
                    <input type="text" name="username" required><br><br>
                    <label for="password">Password:</label>
                    <input type="password" name="password" required><br><br>
                    <button type="submit">Login</button>
                </form>
            </body>
        </html>
    `);
});

// Handle login POST request at the root level
app.post('/', (req, res) => {
    const { username, password } = req.body;

    if (username === validUsername && password === validPassword) {
        // Store login status in session
        req.session.loggedIn = true;
        res.redirect('/getqrcode');  // Redirect to QR code page
    } else {
        res.send(`
            <html>
                <body>
                    <h1>Login Failed</h1>
                    <p>Invalid username or password. Please try again.</p>
                    <a href="/">Go back to login</a>
                </body>
            </html>
        `);
    }
});

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
    if (req.session.loggedIn) {
        next();
    } else {
        res.redirect('/');  // Redirect to login if not authenticated
    }
}

// Express route to display the QR code in the browser (protected by authentication)
app.get('/getqrcode', isAuthenticated, (req, res) => {
    if (isClientReady) {
        res.send(`
            <html>
                <body>
                    <h1>WhatsApp Client is already authenticated!</h1>
                </body>
            </html>
        `);
    } else if (qrCodeData) {
        res.send(`
            <html>
                <body>
                    <h1>Scan the QR Code to authenticate WhatsApp:</h1>
                    <img src="${qrCodeData}" alt="WhatsApp QR Code"/>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <html>
                <body>
                    <h1>QR Code not available yet. Please wait...</h1>
                </body>
            </html>
        `);
    }
});

// API endpoint to send a message, secured with API key
app.post('/send-message', verifyApiKey, async (req, res) => {
    const { number, message } = req.body;

    // Check if the required fields are provided
    if (!number || !message) {
        return res.status(400).json({ status: 'error', message: 'Please provide both number and message' });
    }

    try {
        // Wait for the client to be ready, retry 5 times with a 2-second delay
        await waitForClientReady(5, 2000);

        const formattedNumber = `${number}@c.us`; // Format the number for WhatsApp API
        const timestamp = new Date().toISOString(); // Format timestamp in ISO format

        client.sendMessage(formattedNumber, message)
            .then((response) => {
                res.status(200).json({
                    status: 'success',
                    message: 'Message sent successfully',
                    response: response
                });        
                  
            })
            .catch((error) => {
                res.status(500).json({
                    status: 'error',
                    message: 'Failed to send message',
                    error: error.toString()
                });
            });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            message: 'Client is not ready, please try again later',
            error: error.message
        });
    }
});

// Start the Express server
app.listen(port, () => {
    const serverMessage = `Server is running on http://localhost:${port}`;
    console.log(serverMessage);
});
