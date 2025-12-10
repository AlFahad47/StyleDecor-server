const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const serviceAccount = require("./admin-key.json");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000;
const crypto = require("crypto");

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.icmxc0o.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("style_decor_db");
    const userCollection = db.collection("users");
    const serviceCollection = db.collection("services");
    const bookingCollection = db.collection("bookings");
    const paymentCollection = db.collection("payments");
    // add users
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });
    // to decorator
    app.patch(
      "/users/decorator/:id",

      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { role: "decorator" } };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // to user
    app.patch("/users/user/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = { $set: { role: "user" } };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });
    // change account status
    app.patch("/users/status/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body; // 'active' or 'disabled'
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = { $set: { status: status } };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });
    // add services
    app.post("/services", async (req, res) => {
      const service = req.body;
      const result = await serviceCollection.insertOne(service);
      res.send(result);
    });
    // get services and search filter
    app.get("/services", async (req, res) => {
      const { search, category, min, max } = req.query;
      let query = {};

      if (search) {
        query.service_name = { $regex: search, $options: "i" };
      }

      if (category) {
        query.category = category;
      }

      // price
      if (min || max) {
        query.price = {};
        if (min) query.price.$gte = parseFloat(min);
        if (max) query.price.$lte = parseFloat(max);
      }

      const result = await serviceCollection.find(query).toArray();
      res.send(result);
    });
    // delete services
    app.delete("/services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await serviceCollection.deleteOne(query);
      res.send(result);
    });
    // update services
    app.patch("/services/:id", async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          service_name: item.service_name,
          category: item.category,
          price: item.price,
          unit: item.unit,
          description: item.description,
          //update image if provided
          ...(item.img && { img: item.img }),
        },
      };
      const result = await serviceCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // get single service
    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }

      const query = { _id: new ObjectId(id) };
      const result = await serviceCollection.findOne(query);
      res.send(result);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;

      if (
        !booking.service_id ||
        !booking.email ||
        !booking.date ||
        !booking.address
      ) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      const query = {
        email: booking.email,
        service_id: booking.service_id,
        date: booking.date,
      };
      const existingBooking = await bookingCollection.findOne(query);
      if (existingBooking) {
        return res.send({ message: "already booked", insertedId: null });
      }

      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    // get my bookings
    app.get("/bookings", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.send([]);
      }

      const query = { email };
      const result = await bookingCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }

      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.findOne(query);

      res.send(result);
    });
    // cancel
    app.patch("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: {
          status: "canceled",
        },
      };

      const result = await bookingCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // payment apis
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: `Booking for: ${paymentInfo.serviceName}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        // Pass necessary IDs for database update later
        metadata: {
          bookingId: paymentInfo.bookingId,
          serviceName: paymentInfo.serviceName,
        },
        customer_email: paymentInfo.senderEmail,

        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/my-bookings`,
      });

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        if (!sessionId) {
          return res
            .status(400)
            .send({ success: false, message: "Session ID is missing" });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session) {
          return res
            .status(404)
            .send({ success: false, message: "Session not found" });
        }

        const transactionId = session.payment_intent;
        const bookingId = session.metadata?.bookingId;
        const serviceName = session.metadata?.serviceName;

        if (!bookingId) {
          console.error("ERROR: Booking ID missing in Stripe Metadata");
          return res
            .status(400)
            .send({ success: false, message: "Booking ID missing" });
        }

        const paymentExist = await paymentCollection.findOne({
          transactionId: transactionId,
        });

        if (paymentExist) {
          return res.send({
            message: "already exists",
            transactionId,
            success: true,
            paymentInfo: paymentExist,
          });
        }

        if (session.payment_status === "paid") {
          const bookingQuery = { _id: new ObjectId(bookingId) };

          const bookingUpdate = {
            $set: {
              status: "paid",
              transactionId: transactionId,
            },
          };

          const updateResult = await bookingCollection.updateOne(
            bookingQuery,
            bookingUpdate
          );

          const payment = {
            amount: session.amount_total / 100,
            currency: session.currency,
            customerEmail: session.customer_email,
            bookingId: bookingId,
            serviceName: serviceName,
            transactionId: transactionId,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
          };

          const paymentResult = await paymentCollection.insertOne(payment);

          return res.send({
            success: true,
            modifyBooking: updateResult,
            transactionId: transactionId,
            paymentInfo: payment,
          });
        }

        return res.send({
          success: false,
          message: "Payment status not 'paid'.",
        });
      } catch (error) {
        console.error("Error in /payment-success:", error);
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("StyleDecor running...");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
