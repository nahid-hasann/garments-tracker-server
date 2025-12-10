const express = require('express')
const cors = require('cors');
require('dotenv').config();
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 8000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// middleware
app.use(cors());
app.use(express.json());

// mongo uri
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.bcaijik.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


app.get('/', (req, res) => {
    res.send('Garments Tracker Server Running!')
})

async function run() {
    try {
        await client.connect();

        const db = client.db('garmentsDB');
        const userCollection = db.collection('user');
        const productCollection = db.collection('products');
        const orderCollection = db.collection('orders');



        // app.user 

        app.post('/users', async (req, res) => {
            // console.log("🔥 POST /users hit", req.body); 
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
            if (!email) {
                return res.status(400).send({ message: "Email query is required" });
            }
            const user = await userCollection.findOne({ email })
            res.send(user || {})
        })

        app.get('/users/all', async (req, res) => {
            const user = await userCollection.find().sort({ createdAt: -1 }).toArray();
            res.send(user)
        })

        app.patch('/users/:id', async (req, res) => {
            const id = req.params.id;
            const { role, status } = req.body;
            const updateDoc = {};

            if (role) {
                updateDoc.role = role;
            }

            if (status) {
                updateDoc.status = status;
            }

            const result = await userCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updateDoc }
            )
            res.send(result)
        })

        // app.user 

        // app.product 
        app.post('/products', async (req, res) => {
            const product = req.body;

            // extra field add করছি (তারিখ + ডিফল্ট ফিল্ড)
            product.createdAt = new Date();

            // কিছু default রাখতে চাইলে:
            if (product.showOnHome === undefined) {
                product.showOnHome = false;
            }

            const result = await productCollection.insertOne(product);
            res.send(result);
        });

        app.get('/products', async (req, res) => {
            const { search, category } = req.query;
            const query = {};

            if (search) {
                // name বা title এ search
                query.name = { $regex: search, $options: 'i' };
            }

            if (category) {
                query.category = category;
            }

            const products = await productCollection
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();

            res.send(products);
        });

        app.get('/products/home', async (req, res) => {
            const limit = parseInt(req.query.limit) || 6;

            const products = await productCollection
                .find({ showOnHome: true })
                .sort({ createdAt: -1 })
                .limit(limit)
                .toArray();

            res.send(products);
        });

        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;

            let product;
            try {
                product = await productCollection.findOne({ _id: new ObjectId(id) });
            } catch (err) {
                return res.status(400).send({ message: 'Invalid product id' });
            }

            if (!product) {
                return res.status(404).send({ message: 'Product not found' });
            }

            res.send(product);
        });

        app.delete('/products/:id', async (req, res) => {
            const id = req.params.id
            const result = await productCollection.deleteOne({ _id: new ObjectId(id) })
            res.send(result)
        })

        app.patch('/products/:id', async (req, res) => {
            const id = req.params.id;
            const updateData = req.body;

            const result = await productCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updateData }
            );

            res.send(result);
          });

        // app.product 


        // payment apis 
        // Stripe: create payment intent

        app.post('/create-payment-intent', async (req, res) => {
            try {
                const { amount, currency = "usd" } = req.body;

                if (!amount || amount <= 0) {
                    return res.status(400).send({ message: "Invalid amount" });
                }

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: Math.round(amount * 100), // $10 => 1000 cents
                    currency,
                    automatic_payment_methods: {
                        enabled: true,
                    },
                });

                res.send({
                    clientSecret: paymentIntent.client_secret,
                });
            } catch (err) {
                console.error("Stripe error:", err);
                res.status(500).send({ message: "Failed to create payment intent" });
            }
        });

        // payment apis 

        // order related apis 
        app.post('/orders', async (req, res) => {
            const order = req.body;

            order.createdAt = new Date();
            order.status = "pending";

            const result = await orderCollection.insertOne(order);
            res.send(result);
        });

        app.get('/orders', async (req, res) => {
            const email = req.query.email;
            if (!email) {
                return res.status(400).send({ message: "Email query required" });
            }

            const orders = await orderCollection
                .find({ buyerEmail: email })
                .sort({ createdAt: -1 })
                .toArray();

            res.send(orders);
        });

        app.patch('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;   // "approved" / "rejected" / "pending"

            try {
                const updateDoc = { status };

                // ✅ যদি order approve করা হয়, তাহলে approvedAt set করব
                if (status === "approved") {
                    updateDoc.approvedAt = new Date();
                }

                // চাইলে: আবার pending/rejected করলে approvedAt clear করে দিতে পারো
                else {
                    updateDoc.approvedAt = null;
                }

                const result = await orderCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateDoc }
                );

                res.send(result);
            } catch (err) {
                console.log("Update error:", err);
                res.status(500).send({ message: "Failed to update status" });
            }
        });
        
        // MANAGER / ADMIN: get all orders (no email filter)
        app.get('/orders/all', async (req, res) => {
            try {
                const orders = await orderCollection
                    .find()                // সব order
                    .sort({ createdAt: -1 })
                    .toArray();

                console.log("Total orders:", orders.length); // এটাও helpful

                res.send(orders);
            } catch (err) {
                console.log("Error loading all orders:", err);
                res.status(500).send({ message: "Failed to load orders" });
            }
        });

        // APPROVED ORDERS ONLY
        // APPROVED ORDERS ONLY
        app.get('/orders/approved', async (req, res) => {
            try {
                const orders = await orderCollection
                    .find({ status: "approved" })  // শুধু approved
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(orders);
            } catch (err) {
                console.log("Error loading approved orders:", err);
                res.status(500).send({ message: "Failed to load approved orders" });
            }
        });


        app.get('/orders/:id', async (req, res) => {
            const id = req.params.id;

            try {
                const order = await orderCollection.findOne({ _id: new ObjectId(id) });

                if (!order) {
                    return res.status(404).send({ message: 'Order not found' });
                }

                res.send(order);
            } catch (err) {
                console.log("Error loading order:", err);
                res.status(400).send({ message: 'Invalid order id' });
            }
        });



        app.post('/orders/:id/production-updates', async (req, res) => {
            const id = req.params.id;
            const { stage, note, updatedBy } = req.body;

            const updateDoc = {
                stage,
                updatedBy,
                createdAt: new Date()
            };

            try {
                const result = await orderCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $push: {
                            productionUpdates: updateDoc
                        }
                    }
                );

                res.send(result);
            } catch (err) {
                console.log("Error adding production update:", err);
                res.status(500).send({ message: "Failed to add production update" });
            }
        });

   

  


        // order related apis 



        console.log("MongoDB Connected Successfully!");



    } catch (err) {
        console.log("DB Error:", err)
    }
}
run();


app.listen(port, () => {
    console.log(`Server running on port ${port}`)
})
