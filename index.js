const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// const serviceAccount = require("./admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

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
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};
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
    // await client.connect();
    const db = client.db("style_decor_db");
    const userCollection = db.collection("users");
    const serviceCollection = db.collection("services");
    const bookingCollection = db.collection("bookings");
    const paymentCollection = db.collection("payments");
    const contactCollection = db.collection("contacts");

    const verifyDecorator = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "decorator") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    const verifyUser = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "user") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };
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

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });
    // to decorator
    app.patch(
      "/users/decorator/:id",
      verifyToken,
      verifyAdmin,

      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { role: "decorator" } };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // to user
    app.patch("/users/user/:id", verifyToken, verifyAdmin, async (req, res) => {
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
    app.get("/users/role/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });
    // add services
    app.post("/services", verifyToken, verifyAdmin, async (req, res) => {
      const service = req.body;
      service.createdByEmail = req.decoded_email;
      service.createdAt = new Date();
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
    app.delete("/services/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await serviceCollection.deleteOne(query);
      res.send(result);
    });
    // update services
    app.patch("/services/:id", verifyToken, verifyAdmin, async (req, res) => {
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

    app.post("/bookings", verifyToken, async (req, res) => {
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

    app.get("/bookings/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }

      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.findOne(query);

      res.send(result);
    });
    // cancel
    app.patch("/bookings/:id", verifyToken, async (req, res) => {
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
    app.post("/payment-checkout-session", verifyToken, async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
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

    app.patch("/payment-success", verifyToken, async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const transactionId = session.payment_intent;

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
        const id = session.metadata.bookingId;

        const bookingQuery = { _id: new ObjectId(id) };
        const bookingUpdate = {
          $set: {
            status: "paid",
            transactionId: session.payment_intent,
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
          bookingId: session.metadata.bookingId,
          serviceName: session.metadata.serviceName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        const paymentResult = await paymentCollection.insertOne(payment);

        return res.send({
          success: true,
          modifyBooking: updateResult,
          transactionId: session.payment_intent,
          paymentInfo: payment,
        });
      }

      return res.send({
        success: false,
        message: "Payment status not 'paid'.",
      });
    });

    app.get("/payments", verifyToken, async (req, res) => {
      const queryEmail = req.query.email;
      const decodedEmail = req.decoded_email;

      if (queryEmail !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { customerEmail: queryEmail };
      const result = await paymentCollection
        .find(query)
        .sort({ paidAt: -1 })
        .toArray();
      res.send(result);
    });

    // get decorators
    app.get("/users/decorators", verifyToken, verifyAdmin, async (req, res) => {
      const query = { role: "decorator" };

      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/admin/bookings", verifyToken, verifyAdmin, async (req, res) => {
      const sort = req.query.sort;
      const order = req.query.order;

      let sortOptions = {};

      if (sort === "date") {
        sortOptions = { date: order === "asc" ? 1 : -1 };
      } else if (sort === "status") {
        sortOptions = { status: order === "asc" ? 1 : -1 };
      } else {
        sortOptions = { _id: -1 };
      }

      const result = await bookingCollection.find().sort(sortOptions).toArray();
      res.send(result);
    });

    app.patch(
      "/bookings/assign/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { decoratorId } = req.body;
        const filter = { _id: new ObjectId(id) };
        const decorator = await userCollection.findOne({
          _id: new ObjectId(decoratorId),
        });

        if (!decorator) {
          return res.status(404).send({ message: "Decorator not found" });
        }

        const updatedDoc = {
          $set: {
            decoratorId: decoratorId,
            decoratorName: decorator.displayName,
            decoratorEmail: decorator.email,
            status: "Assigned",
          },
        };

        const result = await bookingCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );
    // get decorator assigned work
    app.get(
      "/bookings/decorator/:email",
      verifyToken,
      verifyDecorator,
      async (req, res) => {
        const email = req.params.email;

        if (req.decoded_email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const query = { decoratorEmail: email };

        const result = await bookingCollection.find(query).toArray();
        res.send(result);
      }
    );

    // update status of service work
    app.patch(
      "/bookings/status/:id",
      verifyToken,
      verifyDecorator,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };

        const updatedDoc = {
          $set: { status: status },
        };

        const result = await bookingCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // decorator home states and history

    app.get(
      "/decorator-stats/:email",
      verifyToken,
      verifyDecorator,
      async (req, res) => {
        const email = req.params.email;

        if (req.decoded_email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const query = { decoratorEmail: email };
        const projects = await bookingCollection.find(query).toArray();

        const totalProjects = projects.length;
        const completedProjects = projects.filter(
          (p) => p.status === "Completed"
        ).length;
        const ongoingProjects = projects.filter(
          (p) => p.status !== "Completed" && p.status !== "Cancelled"
        ).length;

        const totalEarnings = projects
          .filter((p) => p.status === "Completed")
          .reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0);

        const paymentHistory = projects
          .filter((p) => p.status === "Completed")
          .map((p) => ({
            serviceName: p.service_name,
            date: p.date,
            price: p.price,
            customer: p.customerName,
          }));

        res.send({
          totalProjects,
          completedProjects,
          ongoingProjects,
          totalEarnings,
          paymentHistory,
        });
      }
    );
    // decorators personal payments
    app.get(
      "/decorator-payments/:email",
      verifyToken,
      verifyDecorator,
      async (req, res) => {
        const email = req.params.email;

        if (req.decoded_email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const query = {
          decoratorEmail: email,
        };

        const result = await bookingCollection.find(query).toArray();
        res.send(result);
      }
    );

    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const bookings = await bookingCollection.estimatedDocumentCount();
      const services = await serviceCollection.estimatedDocumentCount();

      const payments = await bookingCollection
        .aggregate([
          { $match: { status: { $in: ["paid", "Assigned", "Completed"] } } },
          { $group: { _id: null, totalRevenue: { $sum: "$price" } } },
        ])
        .toArray();
      const revenue = payments.length > 0 ? payments[0].totalRevenue : 0;

      const serviceStats = await bookingCollection
        .aggregate([
          { $match: { status: { $ne: "Cancelled" } } },
          {
            $group: {
              _id: "$service_name",
              count: { $sum: 1 },
              total: { $sum: "$price" },
            },
          },
          { $project: { name: "$_id", count: 1, total: 1, _id: 0 } },
        ])
        .toArray();

      const userBookingStats = await bookingCollection
        .aggregate([
          {
            $group: {
              _id: "$email",
              bookingCount: { $sum: 1 },
            },
          },
          { $sort: { bookingCount: -1 } },
          { $limit: 10 },
        ])
        .toArray();

      res.send({
        users,
        bookings,
        services,
        revenue,
        serviceStats,
        userBookingStats,
      });
    });

    // home page
    app.get("/public/decorators", async (req, res) => {
      const query = { role: "decorator" };
      const result = await userCollection.find(query).limit(4).toArray();
      res.send(result);
    });

    app.post("/contact", async (req, res) => {
      const messageData = req.body;
      messageData.date = new Date();

      const result = await contactCollection.insertOne(messageData);
      res.send(result);
    });

    app.get("/users/profile/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.decoded_email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    app.get("/user-stats/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (req.decoded_email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const userBookings = await bookingCollection.find(query).toArray();

      const totalBookings = userBookings.length;
      const pendingBookings = userBookings.filter(
        (b) => b.status === "pending"
      ).length;
      const completedBookings = userBookings.filter(
        (b) => b.status === "Completed"
      ).length;

      res.send({
        totalBookings,
        pendingBookings,
        completedBookings,
      });
    });

    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
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
