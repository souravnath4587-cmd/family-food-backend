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

interface CartItem {
  productId: ObjectId;
  name: string;
  image: string;
  price: number;
  quantity: number;
}

interface Cart {
  _id?: ObjectId;
  userId: string;
  items: CartItem[];
  createdAt: Date;
  updatedAt: Date;
}

async function run() {
  try {
    await client.connect();

    const db = client.db("FamilyFood-Auth");

    // collections
    const usersCollection = db.collection("user");
    const productsCollection = db.collection("products");
    const cartCollection = db.collection<Cart>("cart");
    const ordersCollection = db.collection("orders");

    app.get("/api/orders/:orderId", async (req: Request, res: Response) => {
      try {
        const { orderId } = req.params;
        const userId = req.headers["user-id"] as string;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "User is not authenticated",
          });
        }

        if (!ObjectId.isValid(orderId as string)) {
          return res.status(400).json({
            success: false,
            message: "Invalid order ID",
          });
        }

        const order = await ordersCollection.findOne({
          _id: new ObjectId(orderId as string),
          userId,
        });

        if (!order) {
          return res.status(404).json({
            success: false,
            message: "Order not found",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Order fetched successfully",
          data: order,
        });
      } catch (error) {
        console.error("Get single order error:", error);

        return res.status(500).json({
          success: false,
          message: "Failed to fetch order",
        });
      }
    });

    app.get("/api/orders", async (req: Request, res: Response) => {
      try {
        const userId = req.headers["user-id"] as string;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "User is not authenticated",
          });
        }

        const orders = await ordersCollection
          .find({ userId })
          .sort({ createdAt: -1 })
          .toArray();

        return res.status(200).json({
          success: true,
          message: "Orders fetched successfully",
          data: orders,
        });
      } catch (error) {
        console.error("Get orders error:", error);

        return res.status(500).json({
          success: false,
          message: "Failed to fetch orders",
        });
      }
    });

    // app.get("/api/orders/:id", async (req: Request, res: Response) => {
    //   try {
    //     const { id } = req.params;

    //     if (!ObjectId.isValid(id as string)) {
    //       return res.status(400).json({
    //         success: false,
    //         message: "Invalid order id",
    //       });
    //     }

    //     const order = await ordersCollection.findOne({
    //       _id: new ObjectId(id as string),
    //     });

    //     if (!order) {
    //       return res.status(404).json({
    //         success: false,
    //         message: "Order not found",
    //       });
    //     }

    //     return res.status(200).json({
    //       success: true,
    //       data: order,
    //     });
    //   } catch (error) {
    //     console.error(error);

    //     return res.status(500).json({
    //       success: false,
    //       message: "Failed to fetch order",
    //     });
    //   }
    // });

    app.post("/api/orders", async (req: Request, res: Response) => {
      try {
        const { customer, shippingAddress, deliveryLocation } = req.body;

        // ==========================================
        // 1. Get user ID
        // ==========================================

        const userId = req.headers["user-id"] as string;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "User is not authenticated",
          });
        }

        // ==========================================
        // 2. Validate customer information
        // ==========================================

        if (!customer?.fullName) {
          return res.status(400).json({
            success: false,
            message: "Full name is required",
          });
        }

        if (!customer?.phone) {
          return res.status(400).json({
            success: false,
            message: "Phone number is required",
          });
        }

        // ==========================================
        // 3. Validate shipping address
        // ==========================================

        if (!shippingAddress?.address) {
          return res.status(400).json({
            success: false,
            message: "Shipping address is required",
          });
        }

        if (!shippingAddress?.city) {
          return res.status(400).json({
            success: false,
            message: "City is required",
          });
        }

        // ==========================================
        // 4. Validate delivery location
        // ==========================================

        if (
          deliveryLocation !== "inside_feni" &&
          deliveryLocation !== "outside_feni"
        ) {
          return res.status(400).json({
            success: false,
            message: "Invalid delivery location",
          });
        }

        // ==========================================
        // 5. Find user's cart
        // ==========================================

        const cart = await cartCollection.findOne({
          userId,
        });

        if (!cart || !cart.items || cart.items.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Your cart is empty",
          });
        }

        // ==========================================
        // 6. Prepare order items
        // ==========================================

        const orderItems = [];

        let subtotal = 0;

        for (const cartItem of cart.items) {
          // ----------------------------------------
          // Validate Product ID
          // ----------------------------------------

          if (!ObjectId.isValid(cartItem.productId.toString())) {
            return res.status(400).json({
              success: false,
              message: `Invalid product ID for ${cartItem.name}`,
            });
          }

          // ----------------------------------------
          // Find current product
          // ----------------------------------------

          const product = await productsCollection.findOne({
            _id: new ObjectId(cartItem.productId.toString()),
          });

          if (!product) {
            return res.status(404).json({
              success: false,
              message: `Product "${cartItem.name}" is no longer available`,
            });
          }

          // ========================================
          // 7. Check stock
          // ========================================

          const availableStock = product.stockQuantity ?? 0;

          if (availableStock < cartItem.quantity) {
            return res.status(400).json({
              success: false,
              message: `Not enough stock for "${product.name}". Available stock: ${availableStock}`,
            });
          }

          // ========================================
          // 8. Calculate current product price
          // ========================================

          const discountPrice = product.discountPrice ?? 0;

          const finalPrice =
            discountPrice > 0 ? product.price - discountPrice : product.price;

          // ========================================
          // 9. Calculate item subtotal
          // ========================================

          const itemSubtotal = finalPrice * cartItem.quantity;

          subtotal += itemSubtotal;

          // ========================================
          // 10. Add item to order
          // ========================================

          orderItems.push({
            productId: product._id,
            name: product.name,
            image:
              product.imageUrl || product.image || product.images?.[0] || "",

            price: finalPrice,

            quantity: cartItem.quantity,

            subtotal: itemSubtotal,
          });
        }

        // ==========================================
        // 11. Calculate shipping
        // ==========================================

        const shippingCost = deliveryLocation === "inside_feni" ? 40 : 100;

        // ==========================================
        // 12. Calculate total
        // ==========================================

        const totalAmount = subtotal + shippingCost;

        // ==========================================
        // 13. Create order
        // ==========================================

        const newOrder = {
          userId,

          customer: {
            fullName: customer.fullName,
            phone: customer.phone,
            email: customer.email || "",
          },

          shippingAddress: {
            address: shippingAddress.address,
            city: shippingAddress.city,
            postalCode: shippingAddress.postalCode || "",
          },

          deliveryLocation,

          items: orderItems,

          subtotal,

          shippingCost,

          totalAmount,

          paymentMethod: "cash_on_delivery",

          paymentStatus: "pending",

          orderStatus: "pending",

          createdAt: new Date(),

          updatedAt: new Date(),
        };

        // ==========================================
        // 14. Insert order
        // ==========================================

        const orderResult = await ordersCollection.insertOne(newOrder);

        // ==========================================
        // 15. Reduce stock
        // ==========================================

        for (const item of orderItems) {
          await productsCollection.updateOne(
            {
              _id: item.productId,
            },
            {
              $inc: {
                stockQuantity: -item.quantity,
              },
              $set: {
                updatedAt: new Date(),
              },
            },
          );
        }

        // ==========================================
        // 16. Clear user's cart
        // ==========================================

        await cartCollection.deleteOne({
          userId,
        });

        // ==========================================
        // 17. Return success response
        // ==========================================

        return res.status(201).json({
          success: true,
          message: "Order placed successfully",

          data: {
            _id: orderResult.insertedId,

            ...newOrder,
          },
        });
      } catch (error) {
        console.error("Create order error:", error);

        return res.status(500).json({
          success: false,
          message: "Failed to place order",
        });
      }
    });

    // cart :
    // ============================================
    // UPDATE CART ITEM QUANTITY
    // PATCH /api/cart/items/:productId
    // ============================================
    app.patch(
      "/api/cart/items/:productId",
      async (req: Request, res: Response) => {
        try {
          const { productId } = req.params;
          const { quantity } = req.body;

          const userId = req.headers["user-id"] as string;

          // Check authentication
          if (!userId) {
            return res.status(401).json({
              success: false,
              message: "User is not authenticated",
            });
          }

          // Validate product ID
          if (!ObjectId.isValid(productId as string)) {
            return res.status(400).json({
              success: false,
              message: "Invalid product ID",
            });
          }

          // Validate quantity
          if (!Number.isInteger(quantity) || quantity < 1) {
            return res.status(400).json({
              success: false,
              message: "Quantity must be at least 1",
            });
          }

          // Update cart item quantity
          const result = await cartCollection.updateOne(
            {
              userId,
              "items.productId": new ObjectId(productId as string),
            },
            {
              $set: {
                "items.$.quantity": quantity,
                updatedAt: new Date(),
              },
            },
          );

          // Check if item was found
          if (result.matchedCount === 0) {
            return res.status(404).json({
              success: false,
              message: "Cart item not found",
            });
          }

          // Get updated cart
          const updatedCart = await cartCollection.findOne({
            userId,
          });

          return res.status(200).json({
            success: true,
            message: "Cart quantity updated successfully",
            data: updatedCart,
          });
        } catch (error) {
          console.error("Update cart quantity error:", error);

          return res.status(500).json({
            success: false,
            message: "Failed to update cart quantity",
          });
        }
      },
    );

    // ============================================
    // REMOVE ITEM FROM CART
    // DELETE /api/cart/items/:productId
    // ============================================
    app.delete(
      "/api/cart/items/:productId",
      async (req: Request, res: Response) => {
        try {
          const { productId } = req.params;

          const userId = req.headers["user-id"] as string;

          // Check authentication
          if (!userId) {
            return res.status(401).json({
              success: false,
              message: "User is not authenticated",
            });
          }

          // Validate product ID
          if (!ObjectId.isValid(productId as string)) {
            return res.status(400).json({
              success: false,
              message: "Invalid product ID",
            });
          }

          // Remove item
          const result = await cartCollection.updateOne(
            {
              userId,
            },
            {
              $pull: {
                items: {
                  productId: new ObjectId(productId as string),
                },
              },
              $set: {
                updatedAt: new Date(),
              },
            },
          );

          // Check if cart was found
          if (result.matchedCount === 0) {
            return res.status(404).json({
              success: false,
              message: "Cart not found",
            });
          }

          // Get updated cart
          const updatedCart = await cartCollection.findOne({
            userId,
          });

          return res.status(200).json({
            success: true,
            message: "Item removed from cart successfully",
            data: updatedCart,
          });
        } catch (error) {
          console.error("Remove cart item error:", error);

          return res.status(500).json({
            success: false,
            message: "Failed to remove cart item",
          });
        }
      },
    );

    // ============================================
    // CLEAR ENTIRE CART
    // DELETE /api/cart
    // ============================================
    app.delete("/api/cart", async (req: Request, res: Response) => {
      try {
        const userId = req.headers["user-id"] as string;

        // Check authentication
        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "User is not authenticated",
          });
        }

        // Clear cart items
        const result = await cartCollection.updateOne(
          {
            userId,
          },
          {
            $set: {
              items: [],
              updatedAt: new Date(),
            },
          },
        );

        // Check if cart exists
        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Cart not found",
          });
        }

        // Get updated cart
        const updatedCart = await cartCollection.findOne({
          userId,
        });

        return res.status(200).json({
          success: true,
          message: "Cart cleared successfully",
          data: updatedCart,
        });
      } catch (error) {
        console.error("Clear cart error:", error);

        return res.status(500).json({
          success: false,
          message: "Failed to clear cart",
        });
      }
    });

    app.get("/api/cart", async (req: Request, res: Response) => {
      try {
        const userId = req.headers["user-id"] as string;

        // Check authentication
        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "User is not authenticated",
          });
        }

        // Find user's cart
        const cart = await cartCollection.findOne({
          userId,
        });

        // If cart does not exist
        if (!cart) {
          return res.status(200).json({
            success: true,
            message: "Cart is empty",
            data: {
              userId,
              items: [],
            },
          });
        }

        return res.status(200).json({
          success: true,
          message: "Cart fetched successfully",
          data: cart,
        });
      } catch (error) {
        console.error("Get cart error:", error);

        return res.status(500).json({
          success: false,
          message: "Failed to fetch cart",
        });
      }
    });

    app.post("/api/cart", async (req: Request, res: Response) => {
      try {
        const { productId, quantity } = req.body;

        // Validate input
        if (!productId) {
          return res.status(400).json({
            success: false,
            message: "Product ID is required",
          });
        }

        if (!quantity || quantity < 1) {
          return res.status(400).json({
            success: false,
            message: "Quantity must be at least 1",
          });
        }

        // TODO:
        // এখানে BetterAuth session থেকে logged-in user-এর ID নিতে হবে
        const userId = req.headers["user-id"] as string;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "User is not authenticated",
          });
        }

        // Find product
        const product = await productsCollection.findOne({
          _id: new ObjectId(productId),
        });

        if (!product) {
          return res.status(404).json({
            success: false,
            message: "Product not found",
          });
        }

        // Find user's cart
        const cart = await cartCollection.findOne({
          userId,
        });

        // If cart does not exist
        if (!cart) {
          const newCart = {
            userId,
            items: [
              {
                productId: product._id,
                name: product.name,
                image: product.imageUrl || product.image || "",
                price:
                  product.discountPrice && product.discountPrice > 0
                    ? product.price - product.discountPrice
                    : product.price,
                quantity,
              },
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await cartCollection.insertOne(newCart);

          return res.status(201).json({
            success: true,
            message: "Product added to cart successfully",
            data: {
              _id: result.insertedId,
              ...newCart,
            },
          });
        }

        // Check if product already exists in cart
        const existingItem = cart.items.find(
          (item: any) => item.productId.toString() === productId,
        );

        if (existingItem) {
          // Increase quantity
          await cartCollection.updateOne(
            {
              userId,
              "items.productId": new ObjectId(productId),
            },
            {
              $inc: {
                "items.$.quantity": quantity,
              },
              $set: {
                updatedAt: new Date(),
              },
            },
          );
        } else {
          // Add new product to cart
          await cartCollection.updateOne(
            {
              userId,
            },
            {
              $push: {
                items: {
                  productId: product._id,

                  name: product.name,
                  image: product.imageUrl || product.image || "",
                  price:
                    product.discountPrice && product.discountPrice > 0
                      ? product.price - product.discountPrice
                      : product.price,
                  quantity,
                },
              },
              $set: {
                updatedAt: new Date(),
              },
            },
          );
        }

        // Get updated cart
        const updatedCart = await cartCollection.findOne({
          userId,
        });

        return res.status(200).json({
          success: true,
          message: "Product added to cart successfully",
          data: updatedCart,
        });
      } catch (error) {
        console.error("Add to cart error:", error);

        return res.status(500).json({
          success: false,
          message: "Failed to add product to cart",
        });
      }
    });

    // stats :

    app.get("/api/admin/stats", async (req: Request, res: Response) => {
      try {
        // Total counts
        const totalProducts = await productsCollection.countDocuments();
        const totalUsers = await usersCollection.countDocuments();
        // const totalOrders = await ordersCollection.countDocuments();

        // // Order status counts
        // const pendingOrders = await ordersCollection.countDocuments({
        //   status: "pending",
        // });

        // const completedOrders = await ordersCollection.countDocuments({
        //   status: "completed",
        // });

        // const cancelledOrders = await ordersCollection.countDocuments({
        //   status: "cancelled",
        // });

        // Total Revenue
        // const revenueResult = await ordersCollection
        //   .aggregate([
        //     {
        //       $match: {
        //         status: "completed",
        //       },
        //     },
        //     {
        //       $group: {
        //         _id: null,
        //         totalRevenue: {
        //           $sum: "$totalAmount",
        //         },
        //       },
        //     },
        //   ])
        //   .toArray();

        // const totalRevenue =
        //   revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        res.status(200).json({
          success: true,
          data: {
            totalProducts,
            totalUsers,
            totalOrders: 4,
            pendingOrders: 0,
            completedOrders: 0,
            cancelledOrders: 0,
            totalRevenue: 0,
          },
        });
      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          message: "Failed to load admin stats.",
        });
      }
    });

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
