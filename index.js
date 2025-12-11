const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8000;

// middleware
app.use(cors({
    origin: [
        'http://localhost:5173',
        'http://localhost:5178',
        'https://your-client-side-app.web.app', // ⚠️ ক্লায়েন্ট ডিপ্লয় করার পর এই লিংকটা এখানে বসাবেন
        'https://another-link.vercel.app'
    ],
    credentials: true
}));

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.bcaijik.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// MiddleWare
const verifyToken = (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'Unauthorized access' });
        }
        req.user = decoded;
        next();
    });
};

async function run() {
    try {
        await client.connect();

        const db = client.db('garmentsDB');
        const userCollection = db.collection('user');
        const productCollection = db.collection('products');
        const orderCollection = db.collection('orders');

        // Auth Related API
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.cookie('token', token, cookieOptions).send({ success: true });
        });

        app.post('/logout', async (req, res) => {
            res.clearCookie('token', { ...cookieOptions, maxAge: 0 }).send({ success: true });
        });
    }

        app.post('/logout', async (req, res) => {
            res.clearCookie('token', {
                maxAge: 0,
                secure: false,
                sameSite: 'lax',
            }).send({ success: true });
        });

        // ================= USER APIs =================
        app.post('/users', async (req, res) => {
            const user = req.body;
            const exist = await userCollection.findOne({ email: user.email })
            if (exist) {
                return res.send({ message: "User already exists" });
            }
            user.createdAt = new Date();
            const result = await userCollection.insertOne(user)
            res.send(result);
        })


        app.get('/users', async (req, res) => {
            const email = req.query.email;
            const user = await userCollection.findOne({ email })
            res.send(user || {})
        })

        // ⭐ Admin Only - VerifyToken আছে
        app.get('/users/all', verifyToken, async (req, res) => {
            const user = await userCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(user)
        })

       
        app.patch('/users/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            // body থেকে suspendReason-ও নিচ্ছি
            const { role, status, suspendReason } = req.body;

            const updateDoc = {};

            if (role) updateDoc.role = role;
            if (status) updateDoc.status = status;

            // যদি সাসপেন্ড রিজন থাকে, সেটাও আপডেট করব
            if (suspendReason) {
                updateDoc.suspendReason = suspendReason;
            }
            // যদি ইউজারকে আবার Active করা হয়, তাহলে রিজন মুছে ফেলব
            if (status === 'active') {
                updateDoc.suspendReason = "";
            }

            const result = await userCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updateDoc }
            )
            res.send(result)
        });


        app.get('/products', async (req, res) => {
            const { search, category, page = 1, limit = 9 } = req.query;
            const query = {};
            if (search) query.name = { $regex: search, $options: 'i' };
            if (category && category !== 'all') query.category = category;

            // Pagination setup
            const pageNumber = parseInt(page);
            const limitNumber = parseInt(limit);
            const skip = (pageNumber - 1) * limitNumber;

            const products = await productCollection.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNumber)
                .toArray();

            const total = await productCollection.countDocuments(query);
            res.send({ products, total });
        });

        app.get('/products/home', async (req, res) => {
            const limit = parseInt(req.query.limit) || 6;
            const products = await productCollection.find({ showOnHome: true }).sort({ createdAt: -1 }).limit(limit).toArray();
            res.send(products);
        });

        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const product = await productCollection.findOne({ _id: new ObjectId(id) });
                res.send(product);
            } catch (err) {
                res.status(400).send({ message: 'Invalid product id' });
            }
        });

        // Private Routes
        app.post('/products', verifyToken, async (req, res) => {
            const product = req.body;
            product.createdAt = new Date();
            if (product.showOnHome === undefined) product.showOnHome = false;
            const result = await productCollection.insertOne(product);
            res.send(result);
        });

        app.delete('/products/:id', verifyToken, async (req, res) => {
            const id = req.params.id
            const result = await productCollection.deleteOne({ _id: new ObjectId(id) })
            res.send(result)
        })

        app.patch('/products/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const updateData = req.body;
            delete updateData._id;
            const result = await productCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updateData }
            );
            res.send(result);
        });

        // ================= ORDER APIs =================
        app.post('/orders', verifyToken, async (req, res) => {
            const order = req.body;
            order.createdAt = new Date();
            if (!order.status) order.status = "pending";
            if (!order.paymentStatus) order.paymentStatus = "unpaid";
            const result = await orderCollection.insertOne(order);
            res.send(result);
        });

        app.get('/orders', verifyToken, async (req, res) => {
            const email = req.query.email;
            if (req.user.email !== email) return res.status(403).send({ message: 'Forbidden access' });
            const orders = await orderCollection.find({ buyerEmail: email }).sort({ createdAt: -1 }).toArray();
            res.send(orders);
        });

        app.get('/orders/all', verifyToken, async (req, res) => {
            const orders = await orderCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(orders);
        });

        app.get('/orders/approved', verifyToken, async (req, res) => {
            const orders = await orderCollection.find({ status: "approved" }).sort({ createdAt: -1 }).toArray();
            res.send(orders);
        });

        app.get('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const order = await orderCollection.findOne({ _id: new ObjectId(id) });
            res.send(order);
        });

        app.patch('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const updateDoc = { status };
            if (status === "approved") updateDoc.approvedAt = new Date();
            else updateDoc.approvedAt = null;
            const result = await orderCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateDoc });
            res.send(result);
        });

        app.post('/orders/:id/production-updates', verifyToken, async (req, res) => {
            const id = req.params.id;
            const { stage, note, updatedBy } = req.body;
            const updateDoc = { stage, note, updatedBy, createdAt: new Date() };
            const result = await orderCollection.updateOne(
                { _id: new ObjectId(id) },
                { $push: { productionUpdates: updateDoc } }
            );
            res.send(result);
        });

        // Stripe
        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const { amount, currency = "usd" } = req.body;
            if (!amount) return res.status(400).send({ message: "Invalid amount" });
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(amount * 100),
                currency,
                automatic_payment_methods: { enabled: true },
            });
            res.send({ clientSecret: paymentIntent.client_secret });
        });

        // ⭐ Admin Analytics API
        app.get('/admin-stats', verifyToken, async (req, res) => {
            try {
                // ১. সব কালেকশনের ডকুমেন্ট সংখ্যা বের করা
                const users = await userCollection.estimatedDocumentCount();
                const products = await productCollection.estimatedDocumentCount();
                const orders = await orderCollection.estimatedDocumentCount();

                // ২. মোট রেভিনিউ (Total Revenue) বের করা (Orders কালেকশনের orderPrice যোগ করে)
                // যাদের পেমেন্ট স্ট্যাটাস 'paid' শুধু তাদের টাকা যোগ করছি (চাইলে সব যোগ করতে পারেন)
                const payments = await orderCollection.aggregate([
                    { $match: { paymentStatus: 'paid' } }, // শুধু পেইড অর্ডার
                    {
                        $group: {
                            _id: null,
                            totalRevenue: { $sum: '$orderPrice' } // orderPrice ফিল্ড যোগ হবে
                        }
                    }
                ]).toArray();

                const revenue = payments.length > 0 ? payments[0].totalRevenue : 0;

                res.send({
                    users,
                    products,
                    orders,
                    revenue
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to fetch stats" });
            }
        });

        // console.log("MongoDB Connected Successfully!");
    } catch (err) {
        console.log("DB Error:", err)
    }
}
run();

app.get('/', (req, res) => {
    res.send('Garments Tracker Server Running!')
})

app.listen(port, () => {
    console.log(`Server running on port ${port}`)
})