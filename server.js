const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const brevo = require('@getbrevo/brevo');
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
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 50000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB Connected to Atlas");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  }
};

connectDB();

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

// ----------------- BREVO EMAIL CONFIGURATION -----------------
const defaultClient = brevo.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new brevo.TransactionalEmailsApi();

async function sendEmail(mailOptions) {
  try {
    console.log("📧 Attempting to send email via Brevo...");
    console.log(`To: ${mailOptions.to}`);
    console.log(`Subject: ${mailOptions.subject}`);
    
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { 
      email: process.env.EMAIL_USER, 
      name: "SmartTrack System" 
    };
    sendSmtpEmail.to = [{ email: mailOptions.to }];
    sendSmtpEmail.subject = mailOptions.subject;
    sendSmtpEmail.htmlContent = mailOptions.html;
    
    if (mailOptions.text) {
      sendSmtpEmail.textContent = mailOptions.text;
    }

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Email sent successfully via Brevo API!");
    console.log("Message ID:", data.messageId);
    return { success: true, messageId: data.messageId };
  } catch (error) {
    console.error("❌ Brevo email sending failed:");
    console.error("Error:", error.message);
    if (error.response) {
      console.error("Response:", error.response.body);
    }
    return { success: false, error: error.message };
  }
}

// ----------------- EMAIL FUNCTIONS -----------------
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
    console.log("✅ Low stock alert stored in database");

    const currentDate = new Date().toLocaleString();
    
    const mailOptions = {
      to: process.env.ADMIN_EMAIL,
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
      `
    };

    const emailResult = await sendEmail(mailOptions);
    if (emailResult.success) {
      console.log(`✅ Low stock alert email sent for ${productName} (${currentQty}kg)`);
    } else {
      console.error(`❌ Failed to send low stock alert email: ${emailResult.error}`);
    }
    
  } catch (error) {
    console.error("❌ Error in sendLowStockAlert:", error);
  }
};

// ... (KEEP ALL YOUR EXISTING ROUTES THE SAME, JUST UPDATE THE EMAIL SENDING PARTS)

// ✅ SUBMIT STAFF ENQUIRY - Updated email section
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
    console.log("✅ Staff enquiry stored in database");

    // Send email notification to admin
    const mailOptions = {
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

    const emailResult = await sendEmail(mailOptions);
    if (emailResult.success) {
      console.log("✅ Staff enquiry email sent to admin");
    } else {
      console.error(`❌ Failed to send staff enquiry email: ${emailResult.error}`);
    }

    res.json({ success: true, message: "Enquiry submitted successfully!" });
  } catch (err) {
    console.error("Error submitting enquiry:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ... (CONTINUE WITH ALL YOUR OTHER ROUTES, REMOVING THE 'from' FIELD FROM MAILOPTIONS)

// ----------------- SERVER START -----------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Email User: ${process.env.EMAIL_USER}`);
  console.log(`👤 Admin Email: ${process.env.ADMIN_EMAIL}`);
  console.log(`🔑 Brevo API Key: ${process.env.BREVO_API_KEY ? 'Set' : 'Not Set'}`);
});
