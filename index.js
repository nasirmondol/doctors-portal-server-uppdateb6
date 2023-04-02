const express = require('express')

const app = express()
var cors = require('cors')
const port = process.env.PORT || 5000;

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


require('dotenv').config()
var jwt = require('jsonwebtoken');


app.use(cors())
app.use(express.json())

app.get('/', async (req, res) => {
    res.send('doctors portal server running')
})



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.n2ajigj.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJwt(req, res, next) {
    console.log(req.headers.authorization)
    const authHeaders = req.headers.authorization;
    if (!authHeaders) {
        return res.status(401).send('unauthorized access')
    }
    const token = authHeaders.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })


}

async function run() {
    try {
        const appointmentOptionCollection = client.db('doctors-portal-update6').collection('appointmentOption')
        const bookingsCollection = client.db('doctors-portal-update6').collection('bookings')
        const usersCollection = client.db('doctors-portal-update6').collection('users')
        const doctorsCollection = client.db('doctors-portal-update6').collection('doctors')

        // Note: Make sure you can use verifyAdmin after verify jwt.

        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query);
            if (user?.role !== "admin") {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        app.get('/appointment', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();
            console.log(options)

            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.modals === option.name)
                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots
                console.log(date, option.name, remainingSlots.length)
            })
            res.send(options)
        });

        // Update price to the appointmentoption collection to the database.
        app.get('/addprice', async (req, res) => {
            const filter = {}
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    price: 99
                }
            }
            const result = await appointmentOptionCollection.updateMany(filter, updateDoc, options)
            res.send(result);
        });


        app.get('/bookings', verifyJwt, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        });

        // Payment intent
        app.post('/create-payment-intent', verifyJwt, verifyAdmin, async (req, res) => {
            const bookings = req.body;
            const price = bookings.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            })

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })


        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const booking = await bookingsCollection.findOne(filter);
            res.send(booking)
        })

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query)
            res.send({ isAdmin: user?.role === 'admin' })
        })



        // Save user info to the database
        app.post('/users', async (req, res) => {
            const query = req.body;
            const user = await usersCollection.insertOne(query)
            res.send(user)
        });

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users)
        });

        app.put('/users/admin/:id', verifyJwt, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }

            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        })


        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query)
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            }
            res.status(403).send({ accessToken: 'token' })

        })

        app.post('/bookings', async (req, res) => {
            const bookings = req.body;
            console.log(bookings)

            // One booking for per one user.
            const query = {
                appointmentDate: bookings.appointmentDate,
                email: bookings.email,
                modals: bookings.modals
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You have already booked on a ${bookings.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }
            const result = await bookingsCollection.insertOne(bookings)
            res.send(result);
        })

        app.get('/appointmentSelected', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray()
            res.send(result);
        });

        app.post('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const query = req.body;
            const result = await doctorsCollection.insertOne(query)
            res.send(result);
        });

        app.get('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const query = {}
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        });

        app.delete('/doctors/:id', verifyJwt, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })

        app.get('/v2/appointment', async (req, res) => {
            const date = req.body.date;
            const options = await appointmentOptionCollection.aggregate([
                {
                    $lookup: {
                        from: 'bookings',
                        localField: 'name',
                        foreignField: 'modals',
                        pipeline: [
                            {
                                $match: {
                                    expr: {
                                        $eq: ['$appointmentDate', date]
                                    }
                                }
                            }
                        ],
                        as: 'booked'
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: 1,
                        price: 1,
                        booked: {
                            $map: {
                                input: 'booked',
                                as: 'book',
                                in: '$$book.slot'
                            }
                        }
                    }
                },
                {
                    $project: {
                        name: 1,
                        price: 1,
                        slots: {
                            $setDifferent: ['$slots', '$booked']
                        }
                    }
                }
            ]).toArray()
            res.send(options);
        })
    }
    finally {

    }
}
run().catch(console.dir);


app.listen(port, () => {
    console.log(`Running the port server on ${port}`)
})