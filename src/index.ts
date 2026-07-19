import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// mongodb connection
const uri = process.env.MONGODB_URI as string;

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

    const db = client.db("FamilyFood-Auth");

    // collections
    const usersCollection = db.collection("user");
    const productsCollection = db.collection("products");

    // routes
    app.get(
      "/api/users",
      async (_req: Request<{ userId: string }>, res: Response) => {
        const result = await usersCollection.find().toArray();
        res.send(result);
      },
    );

    app.patch(
      "/api/users/:userId/role",
      async (req: Request, res: Response) => {
        try {
          const { userId } = req.params;
          const { role } = req.body;

          if (!ObjectId.isValid(userId as string)) {
            return res.status(400).json({
              error: "Invalid user id",
            });
          }

          if (!["user", "admin"].includes(role)) {
            return res.status(400).json({
              error: "Invalid role",
            });
          }

          const result = await usersCollection.findOneAndUpdate(
            { _id: new ObjectId(userId as string) },
            { $set: { role } },
            { returnDocument: "after" },
          );

          if (!result) {
            return res.status(404).json({
              error: "User not found",
            });
          }

          res.status(200).json(result);
        } catch (error) {
          console.error(error);

          res.status(500).json({
            error: "Internal Server Error",
          });
        }
      },
    );

    app.patch(
      "/api/users/:userId/block",
      async (req: Request<{ userId: string }>, res: Response) => {
        try {
          const { userId } = req.params;
          const { isBlocked } = req.body;

          if (!ObjectId.isValid(userId)) {
            return res.status(400).json({
              error: "Invalid user id",
            });
          }

          if (typeof isBlocked !== "boolean") {
            return res.status(400).json({
              error: "isBlocked must be a boolean",
            });
          }

          const result = await usersCollection.findOneAndUpdate(
            { _id: new ObjectId(userId) },
            {
              $set: {
                isBlocked,
              },
            },
            {
              returnDocument: "after",
            },
          );

          if (!result) {
            return res.status(404).json({
              error: "User not found",
            });
          }

          return res.status(200).json(result);
        } catch (error) {
          console.error(error);

          return res.status(500).json({
            error: "Internal Server Error",
          });
        }
      },
    );

    app.delete("/api/users/:userId", async (req: Request, res: Response) => {
      try {
        const { userId } = req.params;

        if (!ObjectId.isValid(userId as string)) {
          return res.status(400).json({
            error: "Invalid user id",
          });
        }

        const result = await usersCollection.deleteOne({
          _id: new ObjectId(userId as string),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({
            error: "User not found",
          });
        }

        return res.status(200).json({
          message: "User deleted successfully",
        });
      } catch (error) {
        console.error(error);

        return res.status(500).json({
          error: "Internal server error",
        });
      }
    });

    // app.get("/api/products", async (req: Request, res: Response) => {
    //   const result = await productsCollection.find().toArray();
    //   res.status(200).send(result);
    // });

    app.get("/api/products/:id", async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        // Validate ObjectId
        if (!ObjectId.isValid(id as string)) {
          return res.status(400).json({
            success: false,
            message: "Invalid product id.",
          });
        }

        const product = await productsCollection.findOne({
          _id: new ObjectId(id as string),
        });

        if (!product) {
          return res.status(404).json({
            success: false,
            message: "Product not found.",
          });
        }

        res.status(200).json({
          success: true,
          data: product,
        });
      } catch (error) {
        console.error("Get Product Error:", error);

        res.status(500).json({
          success: false,
          message: "Internal Server Error",
        });
      }
    });

    app.patch("/api/products/:id", async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const updatedData = req.body;

        if (!ObjectId.isValid(id as string)) {
          return res.status(400).json({
            success: false,
            message: "Invalid product id",
          });
        }

        const filter = {
          _id: new ObjectId(id as string),
        };

        const updateDoc = {
          $set: {
            ...updatedData,
            updatedAt: new Date(),
          },
        };

        const result = await productsCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Product not found",
          });
        }

        const updatedProduct = await productsCollection.findOne(filter);

        res.status(200).json({
          success: true,
          message: "Product updated successfully",
          data: updatedProduct,
        });
      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          message: "Failed to update product",
        });
      }
    });

    app.post("/api/products", async (req: Request, res: Response) => {
      const query = req.body;
      const result = await productsCollection.insertOne(query);
      res.send(result);
    });

    app.delete("/api/products/:id", async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id as string)) {
          return res.status(400).json({
            success: false,
            message: "Invalid product id",
          });
        }

        const filter = {
          _id: new ObjectId(id as string),
        };

        const product = await productsCollection.findOne(filter);

        if (!product) {
          return res.status(404).json({
            success: false,
            message: "Product not found",
          });
        }

        const result = await productsCollection.deleteOne(filter);

        if (result.deletedCount === 0) {
          return res.status(500).json({
            success: false,
            message: "Failed to delete product",
          });
        }

        res.status(200).json({
          success: true,
          message: "Product deleted successfully",
        });
      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          message: "Internal server error",
        });
      }
    });

    app.get("/", (_req: Request, res: Response) => {
      res.send("FamilyFood Backend Server Running");
    });

    app.get("/api/products", async (_req: Request, res: Response) => {
      const products = await productsCollection.find().toArray();
      res.send(products);
    });

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.log(error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
