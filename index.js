require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 5000;
app.use(express.json());

const corsOptions = {
  origin: [
    process.env.SITE_DOMAIN,
    process.env.FRONTEND_ORIGIN,
    'http://localhost:5173'
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Initialize Firebase Admin
try {
  if (!process.env.FB_SERVICE_KEY) {
    console.warn('FB_SERVICE_KEY not set. Firebase Admin will not initialize.');
  } else {
    const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(decoded);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized');
  }
} catch (err) {
  console.error('Failed to initialize Firebase Admin:', err);
}

const verifyFireBaseToken = async (req, res, next) => {
  const tokenHeader = req.headers.authorization;
  if (!tokenHeader) {
    return res.status(401).send({ message: 'Unauthorized access: missing token' });
  }
  try {
    const idToken = tokenHeader.split(' ')[1];
    if (!admin.apps.length) {
      return res.status(500).send({ message: 'Firebase admin not initialized' });
    }
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).send({ message: 'Forbidden access' });
  }
};

const username = encodeURIComponent(process.env.DB_USERNAME || '');
const password = encodeURIComponent(process.env.DB_PASSWORD || '');
const cluster = process.env.DB_CLUSTER || 'mystic.fupfbwc.mongodb.net';
const options = process.env.DB_OPTIONS || '?retryWrites=true&w=majority';
const uri = `mongodb+srv://${username}:${password}@${cluster}/${options}`;

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
    const db = client.db("myDB");
    const userCollection = db.collection("users");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection("orders");
    const wishlistCollection = db.collection("wishlist");
    const reviewsCollection = db.collection("reviews");

    // --- USERS ROUTES ---
    app.get('/users', verifyFireBaseToken, async (req, res) => {
      try {
        const result = await userCollection.find().toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch users' });
      }
    });

    app.get('/users/role/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: 'User not found', role: null });
        res.send({ role: user.role || 'user' });
      } catch (err) {
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });

    app.post('/users', async (req, res) => {
      try {
        const newUser = req.body;
        if (!newUser?.email) return res.status(400).send({ message: 'Missing email' });
        const exists = await userCollection.findOne({ email: newUser.email });
        if (exists) return res.send({ message: 'User already exists', insertedId: null });
        const result = await userCollection.insertOne(newUser);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Internal server error' });
      }
    });
    //Patch Role by id 
    app.patch('/users/:id', verifyFireBaseToken, async (req, res) => {
      const userId = req.params.id;
      const updates = req.body;
      const id = { _id: new ObjectId(userId) };
      const updateDoc = { $set: updates };
      const result = await userCollection.updateOne(id, updateDoc);
      res.send(result);
    });
    app.patch('/users/update/:email', verifyFireBaseToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (req.decoded_email !== email) return res.status(403).send({ message: 'Forbidden access' });
        const updates = req.body;
        const result = await userCollection.updateOne({ email }, { $set: { name: updates.name, photoURL: updates.photoURL } });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to update user' });
      }
    });


    // --- BOOKS ROUTES ---
    app.get('/books', async (req, res) => {
      try {
        // CHANGED: Sort by _id descending (Latest first) instead of price
        const result = await booksCollection.find().sort({ _id: -1 }).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch books' });
      }
    });

    app.get('/books/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid Book ID format' });
        }
        const query = { _id: new ObjectId(id) };
        const result = await booksCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: 'Book not found' });
        }
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to get book' });
      }
    });
    //Get Books by email
    app.get('/my-books/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      // This was already sorting by added_date -1 (Correct)
      const result = await booksCollection.find(query).sort({ added_date: -1 }).toArray();
      res.send(result);
    });

    app.post('/books', verifyFireBaseToken, async (req, res) => {
      try {
        const newBook = req.body;
        newBook.added_date = new Date();
        const result = await booksCollection.insertOne(newBook);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to add book' });
      }
    });

    app.delete('/books/:id', verifyFireBaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await booksCollection.deleteOne(query);
        if (result.deletedCount === 0) return res.status(404).send({ message: 'Book Not Found' });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete book' });
      }
    });

    app.patch('/books/:id', verifyFireBaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const cleanData = Object.fromEntries(
          Object.entries(req.body).filter(([_, value]) => value !== undefined)
        );
        const updateDoc = { $set: cleanData };
        const result = await booksCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to update book' });
      }
    });

    app.patch('/books/status/:id', verifyFireBaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const status = req.body;
        const query = { _id: new ObjectId(id) };
        const book = await booksCollection.findOne(query);
        if (!book) return res.status(404).send({ message: 'Book not found' });
        if (req.decoded_email !== book.author) return res.status(403).send({ message: 'Forbidden access' });
        const result = await booksCollection.updateOne(query, { $set: { status: status } });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to update book status' });
      }
    });


    // --- ORDERS ROUTES ---
    app.get('/orders', verifyFireBaseToken, async (req, res) => {
      try {
        const query = {};
        const { email } = req.query;
        if (email && req.decoded_email !== email) return res.status(403).send({ message: 'Forbidden access' });
        if (email) query.email = email;
        const result = await ordersCollection.find(query).sort({ _id: -1 }).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch orders' });
      }
    });
    //Get Orders By Author
    app.get('/orders/:author', verifyFireBaseToken, async (req, res) => {
      try {
        const author = req.params.displayName;
        const result = await ordersCollection.find(author).sort({ _id: -1 }).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch librarian orders' });
      }
    });
    app.post('/orders', verifyFireBaseToken, async (req, res) => {
      try {
        const newOrder = req.body;
        if (req.decoded_email !== newOrder.email) return res.status(403).send({ message: 'Forbidden access' });
        const exists = await ordersCollection.findOne({ bookId: newOrder.bookId, email: newOrder.email });
        if (exists) return res.send({ message: 'You have already ordered this book', insertedId: null });
        const result = await ordersCollection.insertOne(newOrder);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to create order' });
      }
    });

    app.delete('/orders/:id', verifyFireBaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await ordersCollection.deleteOne(query);
        if (result.deletedCount === 0) return res.status(404).send({ message: 'Order Not Found' });
        res.send({ message: 'Order Deleted Successfully', deletedId: id });
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete order' });
      }
    });

    app.patch('/orders/status/:id', verifyFireBaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid Order ID' });
        }
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { status: status }
        };
        const result = await ordersCollection.updateOne(query, updateDoc);
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Order not found' });
        }
        res.send(result);
      } catch (err) {
        console.error("Error updating order status:", err);
        res.status(500).send({ message: 'Failed to update order status' });
      }
    });
    //Patch Order Status into Cancel For User
    app.patch('/orders/cancel/:id', verifyFireBaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid Order ID' });
        }

        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { status: 'cancelled' }
        };

        const result = await ordersCollection.updateOne(query, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Order not found' });
        }

        res.send(result);
      } catch (err) {
        console.error("Cancel Error:", err);
        res.status(500).send({ message: "Failed to cancel order" });
      }
    });
    // Payment & Stripe
    app.post('/payment-checkout-session', async (req, res) => {
      const orderInfo = req.body;
      const price = parseInt(orderInfo.price) * 100;
      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: orderInfo.bookTitle,
                  images: [orderInfo.image]
                },
                unit_amount: price
              },
              quantity: 1
            }
          ],
          customer_email: orderInfo.email,
          mode: 'payment',
          metadata: {
            orderId: orderInfo._id.toString(),
            userEmail: orderInfo.email
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`
        });
        res.send({ url: session.url });
      } catch (error) {
        res.status(500).send({ message: "Stripe session failed" });
      }
    });

    app.patch('/payment-success', async (req, res) => {
      const session_id = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status === 'paid') {
        const id = session.metadata.orderId
        const transactionId = session.payment_intent
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            payment_status: 'paid',
            transactionId: transactionId,
            paymentDate: new Date()
          }
        }
        const result = ordersCollection.updateOne(query, update)
        res.send(result)
      }
      res.send({ success: false })
    })

    app.get('/payments', async (req, res) => {
      try {
        const email = req.query.email;
        const query = { email: email, payment_status: 'paid' };
        const result = await ordersCollection.find(query).sort({ paymentDate: -1 }).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch payments' });
      }
    });


    // --- REVIEWS ROUTES ---
    app.post('/reviews', verifyFireBaseToken, async (req, res) => {
      try {
        const review = req.body;
        if (req.decoded_email !== review.userEmail) {
          return res.status(403).send({ message: 'Forbidden access' });
        }
        const query = {
          bookId: review.bookId,
          email: review.userEmail,
        };
        const hasPurchased = await ordersCollection.findOne(query);
        if (!hasPurchased) {
          return res.status(403).send({ message: 'You can only review books you have purchased' });
        }
        const existingReview = await reviewsCollection.findOne({
          bookId: review.bookId,
          userEmail: review.userEmail
        });
        if (existingReview) {
          return res.status(409).send({ message: 'You have already reviewed this book.' });
        }
        review.date = new Date();
        const result = await reviewsCollection.insertOne(review);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to submit review' });
      }
    });

    app.get('/reviews/:bookId', async (req, res) => {
      try {
        const bookId = req.params.bookId;
        const result = await reviewsCollection.find({ bookId }).sort({ date: -1 }).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch reviews' });
      }
    });


    // --- WISHLIST ROUTES ---
    app.post('/wishlist', async (req, res) => {
      const wishlistItem = req.body;
      const { bookId, userEmail } = wishlistItem;
      const query = { bookId, userEmail };
      const existingItem = await wishlistCollection.findOne(query);
      if (existingItem) {
        return res.status(409).send({ message: 'Book already in wishlist' });
      }
      const result = await wishlistCollection.insertOne(wishlistItem);
      res.send(result);
    });

    app.get('/wishlist', async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      const result = await wishlistCollection.find(query).sort({ _id: -1 }).toArray();
      res.send(result);
    });

    app.delete('/wishlist/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await wishlistCollection.deleteOne(query);
      res.send(result);
    });

    // --- STATS ---
    app.get('/stats', verifyFireBaseToken, async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();
        const admins = await userCollection.countDocuments({ role: "admin" });
        const librarians = await userCollection.countDocuments({ role: "librarian" });
        const users = await userCollection.countDocuments({ role: "user" });
        const books = await booksCollection.countDocuments();
        const totalOrders = await ordersCollection.countDocuments();
        const pendingOrders = await ordersCollection.countDocuments({ status: "pending" });
        const cancelledOrders = await ordersCollection.countDocuments({ status: "cancelled" });
        const completedOrders = await ordersCollection.countDocuments({ status: "delivered" });
        res.send({
          totalUsers, admins, librarians, users, books, totalOrders, pendingOrders, cancelledOrders, completedOrders
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load admin stats" });
      }
    });
    // Root
    app.get('/', (req, res) => {
      res.send("Hello form Server");
    });

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

  } catch (e) {
    console.error('Error during run():', e);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});