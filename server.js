const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
require("dotenv").config();

const app = express();

// ----------------- MIDDLEWARE -----------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "smarttrack-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 2 },
  })
);

// ----------------- DATABASE -----------------
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// ----------------- SCHEMAS -----------------
const stockSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  qty: { type: Number, required: true, default: 0 },
});
const Stock = mongoose.model("Stock", stockSchema);

const staffSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  username: String,
  password: String,
});
const Staff = mongoose.model("Staff", staffSchema);

const stockLogSchema = new mongoose.Schema({
  productName: String,
  operation: String,
  amount: Number,
  staffName: { type: String, default: "Unknown Staff" },
  timestamp: { type: Date, default: Date.now },
});
const StockLog = mongoose.model("StockLog", stockLogSchema);

// ✅ ADD ENQUIRY SCHEMA
const enquirySchema = new mongoose.Schema({
  type: { type: String, required: true }, // 'low_stock' or 'staff_enquiry'
  staffName: String,
  staffEmail: String,
  staffUsername: String,
  productName: String,
  quantity: Number,
  message: String,
  currentStock: Number, // For low stock alerts
  timestamp: { type: Date, default: Date.now }
});
const Enquiry = mongoose.model("Enquiry", enquirySchema);

// ----------------- MIDDLEWARE -----------------
const requireAdminAuth = (req, res, next) => {
  if (req.session.admin) {
    next();
  } else {
    res.redirect("/admin-login");
  }
};

const requireStaffAuth = (req, res, next) => {
  if (req.session.username) {
    next();
  } else {
    res.redirect("/staff-login");
  }
};

// ----------------- EMAIL ALERT FUNCTION -----------------
const sendLowStockAlert = async (staffUsername, productName, currentQty, operationAmount) => {
  try {
    // Get staff details
    const staff = await Staff.findOne({ username: staffUsername });
    if (!staff) {
      console.log("Staff not found for low stock alert");
      return;
    }

    // ✅ STORE LOW STOCK ALERT IN DATABASE
    const lowStockEnquiry = new Enquiry({
      type: 'low_stock',
      staffName: staff.name,
      staffEmail: staff.email,
      staffUsername: staff.username,
      productName: productName,
      quantity: operationAmount,
      currentStock: currentQty,
      message: `Low stock alert: ${productName} is now at ${currentQty}kg after reduction of ${operationAmount}kg`
    });
    await lowStockEnquiry.save();

    // Create email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const currentDate = new Date().toLocaleString();
    
    const mailOptions = {
      from: `"SmartTrack Alert System" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL, // Send to admin
      subject: `🚨 LOW STOCK ALERT: ${productName} below 200kg`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e74c3c; text-align: center;">🚨 LOW STOCK ALERT</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 4px solid #e74c3c;">
            <h3 style="color: #2c3e50; margin-top: 0;">Product: ${productName}</h3>
            <p style="margin: 8px 0;"><strong>📊 Current Quantity:</strong> ${currentQty} kg</p>
            <p style="margin: 8px 0;"><strong>📉 Reduced By:</strong> ${operationAmount} kg</p>
            <p style="margin: 8px 0;"><strong>⚠️ Status:</strong> ${currentQty < 100 ? 'CRITICALLY LOW' : 'LOW STOCK'}</p>
            <hr style="border: none; border-top: 1px solid #ddd;">
            <p style="margin: 8px 0;"><strong>👤 Staff Name:</strong> ${staff.name}</p>
            <p style="margin: 8px 0;"><strong>📧 Staff Email:</strong> ${staff.email}</p>
            <p style="margin: 8px 0;"><strong>👨‍💼 Staff Username:</strong> ${staff.username}</p>
            <hr style="border: none; border-top: 1px solid #ddd;">
            <p style="margin: 8px 0;"><strong>🕐 Time & Date:</strong> ${currentDate}</p>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #7f8c8d;">
            <p>This is an automated alert from SmartTrack Inventory System</p>
          </div>
        </div>
      `,
      text: `
🚨 LOW STOCK ALERT: ${productName} below 200kg

Product: ${productName}
Current Quantity: ${currentQty} kg
Reduced By: ${operationAmount} kg
Status: ${currentQty < 100 ? 'CRITICALLY LOW' : 'LOW STOCK'}

Staff Details:
- Staff Name: ${staff.name}
- Staff Email: ${staff.email}
- Staff Username: ${staff.username}

Time & Date: ${currentDate}

This is an automated alert from SmartTrack Inventory System.
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Low stock alert sent for ${productName} (${currentQty}kg)`);
    
  } catch (error) {
    console.error("❌ Error sending low stock alert:", error);
  }
};

// ----------------- ROUTES -----------------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin-login", (req, res) => res.sendFile(path.join(__dirname, "admin-login.html")));
app.get("/staff-login", (req, res) => res.sendFile(path.join(__dirname, "staff-login.html")));

// ✅ STAFF CREDENTIAL ROUTE - Using your actual filename
app.get("/staff_credential", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "staff_credential.html"));
});

// STAFF DASHBOARD ROUTES
app.post("/staff-dashboard", (req, res) => {
  if (req.session.username) {
    res.sendFile(path.join(__dirname, "staff-dashboard.html"));
  } else {
    res.redirect("/staff-login");
  }
});

app.get("/staff-dashboard", requireStaffAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "staff-dashboard.html"));
});

// STAFF STOCK AVAILABILITY ROUTES
app.get("/staff-stockavai", requireStaffAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "staff-stockavai.html"));
});

app.post("/staff-stockavai", requireStaffAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "staff-stockavai.html"));
});

// STAFF ENQUIRY ROUTE
app.get("/staff-enquiry", requireStaffAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "staff-enquiry.html"));
});

// ADMIN ENQUIRY ROUTE
app.get("/admin-enquiry", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin-enquiry.html"));
});

// ADMIN DASHBOARD ROUTES
app.post("/admin-dashboard", (req, res) => {
  if (req.session.admin) {
    res.sendFile(path.join(__dirname, "admin-dashboard.html"));
  } else {
    res.redirect("/admin-login");
  }
});

app.get("/admin-dashboard", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin-dashboard.html"));
});

app.get("/admin-stockavai", requireAdminAuth, (req, res) => res.sendFile(path.join(__dirname, "admin-stockavai.html")));
app.get("/admin-history", requireAdminAuth, (req, res) => res.sendFile(path.join(__dirname, "admin-history.html")));

// ----------------- ✅ ENQUIRY ROUTES -----------------
// ✅ GET ALL ENQUIRIES (for admin page)
app.get("/api/enquiries", requireAdminAuth, async (req, res) => {
  try {
    const enquiries = await Enquiry.find().sort({ timestamp: -1 });
    res.json(enquiries);
  } catch (err) {
    console.error("Error fetching enquiries:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ SUBMIT STAFF ENQUIRY
app.post("/api/enquiries", requireStaffAuth, async (req, res) => {
  try {
    const { name, email, productName, quantity, message } = req.body;
    
    // Get staff details from session
    const staff = await Staff.findOne({ username: req.session.username });
    if (!staff) {
      return res.status(400).json({ error: "Staff not found" });
    }

    const enquiry = new Enquiry({
      type: 'staff_enquiry',
      staffName: name,
      staffEmail: email,
      staffUsername: req.session.username,
      productName: productName,
      quantity: quantity,
      message: message
    });

    await enquiry.save();

    // Send email notification to admin
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"SmartTrack Enquiry System" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `📧 New Product Enquiry: ${productName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #007bff; text-align: center;">📧 NEW PRODUCT ENQUIRY</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 4px solid #007bff;">
            <h3 style="color: #2c3e50; margin-top: 0;">Product: ${productName}</h3>
            <p style="margin: 8px 0;"><strong>📦 Quantity Needed:</strong> ${quantity} kg</p>
            <hr style="border: none; border-top: 1px solid #ddd;">
            <p style="margin: 8px 0;"><strong>👤 Staff Name:</strong> ${name}</p>
            <p style="margin: 8px 0;"><strong>📧 Staff Email:</strong> ${email}</p>
            <p style="margin: 8px 0;"><strong>👨‍💼 Staff Username:</strong> ${req.session.username}</p>
            <hr style="border: none; border-top: 1px solid #ddd;">
            <p style="margin: 8px 0;"><strong>💬 Message:</strong></p>
            <div style="background: white; padding: 10px; border-radius: 5px; border: 1px solid #ddd;">
              ${message}
            </div>
            <p style="margin: 8px 0;"><strong>🕐 Time & Date:</strong> ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: "Enquiry submitted successfully!" });
  } catch (err) {
    console.error("Error submitting enquiry:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ----------------- ✅ ADMIN LOGIN ROUTE -----------------
app.post("/admin-login", (req, res) => {
  const { email, password } = req.body;

  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    req.session.admin = email;
    return res.json({ success: true, message: "Admin login successful" });
  } else {
    return res.json({ success: false, message: "Invalid email or password" });
  }
});

// ----------------- ADMIN LOGOUT -----------------
app.post("/admin-logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: "Logout failed" });
    }
    res.json({ success: true, message: "Logout successful" });
  });
});

// ----------------- STAFF LOGOUT -----------------
app.post("/staff-logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: "Logout failed" });
    }
    res.json({ success: true, message: "Logout successful" });
  });
});

// ----------------- STAFF REGISTER -----------------
app.post("/api/staff/register", async (req, res) => {
  try {
    const { name, phone, email, username, password } = req.body;
    const existing = await Staff.findOne({ email });
    if (existing)
      return res.status(400).json({ success: false, message: "Staff already exists." });

    const staff = new Staff({ name, phone, email, username, password });
    await staff.save();

    // Send email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"SmartTrack Admin" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Staff Credentials - SmartTrack",
      text: `Hello ${name},\n\nYour SmartTrack staff account has been created.\n\nUsername: ${username}\nPassword: ${password}\n\n- SmartTrack Admin`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "Staff registered & email sent!" });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------- STAFF LOGIN -----------------
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const staff = await Staff.findOne({ username });
    if (!staff) return res.status(400).json({ error: "User not found" });
    if (staff.password !== password) return res.status(400).json({ error: "Invalid password" });

    req.session.username = staff.username;
    res.json({ message: "Login successful" });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ----------------- STOCK MANAGEMENT -----------------
app.get("/api/stock", async (req, res) => {
  try {
    const stockItems = await Stock.find({});
    res.json(stockItems);
  } catch (err) {
    console.error("Stock Fetch Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/stock/add", async (req, res) => {
  const { name, qty } = req.body;
  if (!name || isNaN(qty) || qty < 0)
    return res.status(400).json({ error: "Invalid input" });

  try {
    let stock = await Stock.findOne({ name: new RegExp(`^${name}$`, "i") });
    let operation = stock ? "Increase" : "Add";

    if (stock) stock.qty += qty;
    else stock = new Stock({ name, qty });

    await stock.save();

    await new StockLog({
      productName: name,
      operation,
      amount: qty,
      staffName: req.session.username || "Unknown Staff",
    }).save();

    res.json({ message: "Stock added/updated", stock });
  } catch (err) {
    console.error("Add Stock Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/stock/increase", async (req, res) => {
  const { name, amount } = req.body;
  try {
    const stock = await Stock.findOne({ name });
    if (!stock) return res.status(404).json({ error: "Product not found" });

    stock.qty += amount;
    await stock.save();

    await new StockLog({
      productName: name,
      operation: "Increase",
      amount,
      staffName: req.session.username || "Unknown Staff",
    }).save();

    res.json({ message: "Quantity increased", stock });
  } catch (err) {
    console.error("Increase Stock Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/stock/decrease", async (req, res) => {
  const { name, amount } = req.body;
  try {
    const stock = await Stock.findOne({ name });
    if (!stock) return res.status(404).json({ error: "Product not found" });
    if (stock.qty < amount) return res.status(400).json({ error: "Not enough stock" });

    const oldQty = stock.qty;
    stock.qty -= amount;
    await stock.save();

    // ✅ Check if stock goes below 200kg and send email alert + store enquiry
    if (stock.qty < 200 && req.session.username) {
      await sendLowStockAlert(req.session.username, name, stock.qty, amount);
    }

    await new StockLog({
      productName: name,
      operation: "Decrease",
      amount,
      staffName: req.session.username || "Unknown Staff",
    }).save();

    res.json({ message: "Quantity decreased", stock });
  } catch (err) {
    console.error("Decrease Stock Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ----------------- HISTORY -----------------
app.get("/api/history", async (req, res) => {
  try {
    const { staff } = req.query;
    let filter = {};

    if (staff && staff.trim() !== "") {
      filter.staffName = new RegExp(staff.trim(), "i"); // case-insensitive
    }

    const logs = await StockLog.find(filter).sort({ timestamp: -1 });
    console.log(`📦 History logs fetched: ${logs.length} record(s)`);
    res.json(logs);
  } catch (err) {
    console.error("❌ Error fetching history logs:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ----------------- SERVER START -----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));