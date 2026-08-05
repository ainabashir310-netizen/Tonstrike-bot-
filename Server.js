const express = require('express');
const path = require('path');
const app = express();

// Middleware to parse incoming JSON requests
app.use(express.json());

// Serve static files from your 'Public' directory (case-sensitive)
app.use(express.static(path.join(__dirname, 'Public')));

// In-memory data store for user wallets and withdrawal queues
const userWallets = {};
const withdrawalRequests = [];

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. Fetch saved wallet address for a specific user ID
app.get('/api/get-wallet/:userId', (req, res) => {
  const { userId } = req.params;
  const walletAddress = userWallets[userId] || '';
  return res.json({ success: true, walletAddress });
});

// 2. Save or update wallet address bound to a Telegram user ID
app.post('/api/save-wallet', (req, res) => {
  const { userId, walletAddress } = req.body;

  if (!userId || !walletAddress) {
    return res.status(400).json({ success: false, message: 'Missing User ID or Wallet Address.' });
  }

  userWallets[userId] = walletAddress.trim();
  console.log(`[WALLETS] Updated User ${userId} -> ${walletAddress}`);

  return res.json({ success: true, message: 'Wallet address saved successfully!' });
});

// 3. Process manual withdrawal request
app.post('/api/withdraw', (req, res) => {
  const { userId, username, amount, walletAddress, asset } = req.body;
  const GAS_FEE = 0.25;

  if (!userId || !walletAddress || !amount || !asset) {
    return res.status(400).json({ success: false, message: 'Missing withdrawal details.' });
  }

  const parsedAmount = parseFloat(amount);

  // Validate withdrawal limits
  if (asset === 'USDT' && parsedAmount < 3.00) {
    return res.status(400).json({ success: false, message: 'Minimum USDT withdrawal is $3.00' });
  }

  if (asset === 'TON' && parsedAmount < 1.00) {
    return res.status(400).json({ success: false, message: 'Minimum TON withdrawal is 1.00 TON' });
  }

  const netPayout = (parsedAmount - GAS_FEE).toFixed(2);

  // Store withdrawal request details
  const requestData = {
    id: Date.now(),
    userId,
    username: username || 'N/A',
    walletAddress,
    asset,
    requestedAmount: parsedAmount,
    gasFee: GAS_FEE,
    netPayout: parseFloat(netPayout),
    status: 'PENDING',
    date: new Date().toISOString()
  };

  withdrawalRequests.push(requestData);

  // Print structured log to Render Logs for manual admin payout
  console.log('\n====================================');
  console.log('📌 NEW MANUAL WITHDRAWAL REQUEST');
  console.log(`Request ID : ${requestData.id}`);
  console.log(`User       : @${requestData.username} (ID: ${userId})`);
  console.log(`Address    : ${walletAddress}`);
  console.log(`Requested  : ${parsedAmount} ${asset}`);
  console.log(`Fee Deduct : $${GAS_FEE}`);
  console.log(`PAY USER   : ${netPayout} ${asset}`);
  console.log('====================================\n');

  return res.json({
    success: true,
    message: `Withdrawal request submitted! You will receive ${netPayout} ${asset} after admin review.`
  });
});

// 4. Fallback route: Send index.html for Web App initialization
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});

// Start Express server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
