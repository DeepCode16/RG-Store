"use strict";

const http = require("http");
const { randomUUID } = require("crypto");
const { URL } = require("url");
const { readDb, writeDb, nextId, makeCustomerId, makeOrderId, publicCustomer } = require("./db");

const PORT = Number(process.env.PORT) || 4000;

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(data, null, 2));
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function unauthorized(res, message) {
  sendJson(res, 401, { error: message || "Unauthorized" });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1000000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return null;
  }
  return auth.slice("Bearer ".length);
}

function getSession(db, req) {
  const token = getToken(req);
  if (!token) {
    return null;
  }
  return db.sessions.find(session => session.token === token) || null;
}

function requireAdmin(db, req, res) {
  const session = getSession(db, req);
  if (!session || session.role !== "admin") {
    unauthorized(res, "Admin login required");
    return null;
  }
  return session;
}

function requireCustomer(db, req, res) {
  const session = getSession(db, req);
  if (!session || session.role !== "customer") {
    unauthorized(res, "Customer login required");
    return null;
  }
  const customer = db.customers.find(item => item.id === session.userId);
  if (!customer) {
    unauthorized(res, "Customer session is invalid");
    return null;
  }
  return customer;
}

function sanitizeProduct(product) {
  return {
    ...product,
    image: product.image || ""
  };
}

function summarizeAnalytics(db) {
  const activeCoupons = db.coupons.filter(coupon => coupon.active).length;
  const totalRevenue = db.orders
    .filter(order => order.status !== "cancelled")
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingOrders = db.orders.filter(order => ["pending", "processing"].includes(order.status)).length;
  const paidOrders = db.orders.filter(order => order.payStatus === "paid").length;

  return {
    products: db.products.length,
    categories: db.categories.length,
    customers: db.customers.length,
    orders: db.orders.length,
    pendingOrders,
    paidOrders,
    activeCoupons,
    totalRevenue
  };
}

function applyCoupon(coupon, subtotal) {
  if (!coupon || !coupon.active || subtotal < Number(coupon.minOrder || 0)) {
    return { discount: 0, coupon: null };
  }

  if (coupon.type === "percent") {
    return {
      discount: Math.round((subtotal * Number(coupon.value || 0)) / 100),
      coupon: coupon.code
    };
  }

  return {
    discount: Number(coupon.value || 0),
    coupon: coupon.code
  };
}

function buildOrderItems(products, items) {
  return items.map(item => {
    const product = products.find(entry => Number(entry.id) === Number(item.productId));
    if (!product) {
      throw new Error(`Product ${item.productId} not found`);
    }
    return {
      productId: product.id,
      name: product.name,
      qty: Number(item.qty || 1),
      price: Number(product.price)
    };
  });
}

function routeMatch(pathname, pattern) {
  const actual = pathname.split("/").filter(Boolean);
  const expected = pattern.split("/").filter(Boolean);
  if (actual.length !== expected.length) {
    return null;
  }

  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const part = expected[index];
    const value = actual[index];
    if (part.startsWith(":")) {
      params[part.slice(1)] = value;
      continue;
    }
    if (part !== value) {
      return null;
    }
  }
  return params;
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const db = readDb();

  try {
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "rg-store-backend" });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      const body = await readBody(req);
      const admin = db.adminUsers.find(user => user.username === body.username && user.password === body.password);
      if (!admin) {
        unauthorized(res, "Wrong admin credentials");
        return;
      }
      const token = randomUUID();
      db.sessions.push({ token, role: "admin", userId: admin.id, createdAt: new Date().toISOString() });
      writeDb(db);
      sendJson(res, 200, { token, user: { id: admin.id, name: admin.name, username: admin.username, role: "admin" } });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/register") {
      const body = await readBody(req);
      if (!body.name || !body.phone || !body.password) {
        badRequest(res, "name, phone and password are required");
        return;
      }

      if (db.customers.some(customer => customer.phone === body.phone)) {
        badRequest(res, "Phone already registered");
        return;
      }

      const customer = {
        id: makeCustomerId(db.customers),
        name: body.name,
        phone: body.phone,
        email: body.email || "",
        city: body.city || "",
        joined: new Date().toISOString().slice(0, 10),
        orders: 0,
        totalSpent: 0,
        lastOrder: null,
        password: body.password,
        wishlist: [],
        cart: []
      };
      db.customers.push(customer);

      const token = randomUUID();
      db.sessions.push({ token, role: "customer", userId: customer.id, createdAt: new Date().toISOString() });
      writeDb(db);
      sendJson(res, 201, { token, user: publicCustomer(customer) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readBody(req);
      const customer = db.customers.find(item => {
        const loginId = body.phone || body.email;
        return (item.phone && item.phone === loginId) || (item.email && item.email === loginId);
      });

      if (!customer || customer.password !== body.password) {
        unauthorized(res, "Wrong customer credentials");
        return;
      }

      const token = randomUUID();
      db.sessions.push({ token, role: "customer", userId: customer.id, createdAt: new Date().toISOString() });
      writeDb(db);
      sendJson(res, 200, { token, user: publicCustomer(customer) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/request-otp") {
      const body = await readBody(req);
      const contact = body.phone || body.email;
      if (!contact) {
        badRequest(res, "phone or email is required");
        return;
      }
      const code = "123456";
      db.otpRequests.push({
        id: randomUUID(),
        contact,
        code,
        createdAt: new Date().toISOString()
      });
      writeDb(db);
      sendJson(res, 200, { message: "OTP generated for demo", otp: code });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login-otp") {
      const body = await readBody(req);
      const contact = body.phone || body.email;
      const otp = db.otpRequests.find(entry => entry.contact === contact && entry.code === body.otp);
      if (!otp) {
        unauthorized(res, "Invalid OTP");
        return;
      }
      const customer = db.customers.find(item => item.phone === contact || item.email === contact);
      if (!customer) {
        unauthorized(res, "Customer not found for OTP");
        return;
      }
      const token = randomUUID();
      db.sessions.push({ token, role: "customer", userId: customer.id, createdAt: new Date().toISOString() });
      writeDb(db);
      sendJson(res, 200, { token, user: publicCustomer(customer) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/store") {
      sendJson(res, 200, db.store);
      return;
    }

    if (req.method === "PUT" && pathname === "/api/store") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      const body = await readBody(req);
      db.store = { ...db.store, ...body };
      writeDb(db);
      sendJson(res, 200, db.store);
      return;
    }

    if (req.method === "GET" && pathname === "/api/categories") {
      sendJson(res, 200, db.categories);
      return;
    }

    if (req.method === "POST" && pathname === "/api/categories") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      const body = await readBody(req);
      if (!body.id || !body.name) {
        badRequest(res, "id and name are required");
        return;
      }
      const category = { id: body.id, name: body.name, emoji: body.emoji || "🏷️" };
      db.categories.push(category);
      writeDb(db);
      sendJson(res, 201, category);
      return;
    }

    const categoryParams = routeMatch(pathname, "/api/categories/:id");
    if (categoryParams && req.method === "DELETE") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      db.categories = db.categories.filter(item => item.id !== categoryParams.id);
      writeDb(db);
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/products") {
      const category = url.searchParams.get("category");
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const stock = url.searchParams.get("stock");

      let products = db.products.map(sanitizeProduct);
      if (category && category !== "all") {
        products = products.filter(product => product.cat === category);
      }
      if (stock === "in") {
        products = products.filter(product => product.stock);
      }
      if (stock === "out") {
        products = products.filter(product => !product.stock);
      }
      if (search) {
        products = products.filter(product =>
          product.name.toLowerCase().includes(search) ||
          String(product.brand || "").toLowerCase().includes(search) ||
          String(product.cat || "").toLowerCase().includes(search)
        );
      }
      sendJson(res, 200, products);
      return;
    }

    if (req.method === "POST" && pathname === "/api/products") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      const body = await readBody(req);
      const product = sanitizeProduct({
        id: nextId(db.products, "id"),
        name: body.name,
        cat: body.cat,
        emoji: body.emoji || "📦",
        image: body.image || "",
        price: Number(body.price || 0),
        mrp: Number(body.mrp || 0),
        brand: body.brand || "",
        weight: body.weight || "",
        material: body.material || "",
        size: body.size || "",
        tag: body.tag || "",
        stock: body.stock !== false,
        desc: body.desc || "",
        specs: Array.isArray(body.specs) ? body.specs : [],
        rating: Number(body.rating || 4.5),
        reviews: Number(body.reviews || 0)
      });
      db.products.unshift(product);
      writeDb(db);
      sendJson(res, 201, product);
      return;
    }

    const productParams = routeMatch(pathname, "/api/products/:id");
    if (productParams && req.method === "GET") {
      const product = db.products.find(item => Number(item.id) === Number(productParams.id));
      if (!product) {
        notFound(res);
        return;
      }
      sendJson(res, 200, sanitizeProduct(product));
      return;
    }

    if (productParams && req.method === "PUT") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      const body = await readBody(req);
      const index = db.products.findIndex(item => Number(item.id) === Number(productParams.id));
      if (index === -1) {
        notFound(res);
        return;
      }
      db.products[index] = sanitizeProduct({ ...db.products[index], ...body, id: db.products[index].id });
      writeDb(db);
      sendJson(res, 200, db.products[index]);
      return;
    }

    if (productParams && req.method === "DELETE") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      db.products = db.products.filter(item => Number(item.id) !== Number(productParams.id));
      writeDb(db);
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/coupons") {
      sendJson(res, 200, db.coupons);
      return;
    }

    if (req.method === "POST" && pathname === "/api/coupons") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      const body = await readBody(req);
      const coupon = {
        id: body.id || `c${db.coupons.length + 1}`,
        code: String(body.code || "").toUpperCase(),
        type: body.type || "percent",
        value: Number(body.value || 0),
        minOrder: Number(body.minOrder || 0),
        active: body.active !== false,
        uses: Number(body.uses || 0),
        desc: body.desc || ""
      };
      db.coupons.push(coupon);
      writeDb(db);
      sendJson(res, 201, coupon);
      return;
    }

    const couponParams = routeMatch(pathname, "/api/coupons/:id");
    if (couponParams && req.method === "PUT") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      const body = await readBody(req);
      const index = db.coupons.findIndex(item => item.id === couponParams.id);
      if (index === -1) {
        notFound(res);
        return;
      }
      db.coupons[index] = { ...db.coupons[index], ...body };
      writeDb(db);
      sendJson(res, 200, db.coupons[index]);
      return;
    }

    if (couponParams && req.method === "DELETE") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      db.coupons = db.coupons.filter(item => item.id !== couponParams.id);
      writeDb(db);
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/me") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      sendJson(res, 200, publicCustomer(customer));
      return;
    }

    if (req.method === "GET" && pathname === "/api/me/wishlist") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      const items = (customer.wishlist || [])
        .map(id => db.products.find(product => Number(product.id) === Number(id)))
        .filter(Boolean)
        .map(sanitizeProduct);
      sendJson(res, 200, items);
      return;
    }

    if (req.method === "POST" && pathname === "/api/me/wishlist") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      const body = await readBody(req);
      const productId = Number(body.productId);
      if (!customer.wishlist.includes(productId)) {
        customer.wishlist.push(productId);
      }
      writeDb(db);
      sendJson(res, 200, { success: true, wishlist: customer.wishlist });
      return;
    }

    const wishlistParams = routeMatch(pathname, "/api/me/wishlist/:productId");
    if (wishlistParams && req.method === "DELETE") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      customer.wishlist = (customer.wishlist || []).filter(id => Number(id) !== Number(wishlistParams.productId));
      writeDb(db);
      sendJson(res, 200, { success: true, wishlist: customer.wishlist });
      return;
    }

    if (req.method === "GET" && pathname === "/api/me/cart") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      sendJson(res, 200, customer.cart || []);
      return;
    }

    if (req.method === "POST" && pathname === "/api/me/cart") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      const body = await readBody(req);
      const product = db.products.find(item => Number(item.id) === Number(body.productId));
      if (!product) {
        notFound(res);
        return;
      }
      customer.cart = customer.cart || [];
      const existing = customer.cart.find(item => Number(item.productId) === Number(product.id));
      if (existing) {
        existing.qty += Number(body.qty || 1);
      } else {
        customer.cart.push({
          productId: product.id,
          qty: Number(body.qty || 1),
          price: product.price,
          name: product.name
        });
      }
      writeDb(db);
      sendJson(res, 200, customer.cart);
      return;
    }

    const cartParams = routeMatch(pathname, "/api/me/cart/:productId");
    if (cartParams && req.method === "PATCH") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      const body = await readBody(req);
      const item = (customer.cart || []).find(entry => Number(entry.productId) === Number(cartParams.productId));
      if (!item) {
        notFound(res);
        return;
      }
      item.qty = Math.max(1, Number(body.qty || 1));
      writeDb(db);
      sendJson(res, 200, customer.cart);
      return;
    }

    if (cartParams && req.method === "DELETE") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      customer.cart = (customer.cart || []).filter(entry => Number(entry.productId) !== Number(cartParams.productId));
      writeDb(db);
      sendJson(res, 200, customer.cart);
      return;
    }

    if (req.method === "GET" && pathname === "/api/orders") {
      const session = getSession(db, req);
      if (session && session.role === "customer") {
        const orders = db.orders.filter(order => order.customerId === session.userId);
        sendJson(res, 200, orders);
        return;
      }
      if (!requireAdmin(db, req, res)) {
        return;
      }
      sendJson(res, 200, db.orders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/orders") {
      const customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      const body = await readBody(req);
      const sourceItems = body.items && body.items.length ? body.items : customer.cart;
      if (!sourceItems || !sourceItems.length) {
        badRequest(res, "Cart is empty");
        return;
      }

      const items = buildOrderItems(db.products, sourceItems);
      const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      const shipping = subtotal >= Number(db.store.shippingFree || 0) ? 0 : 60;
      const coupon = db.coupons.find(item => item.code === String(body.couponCode || "").toUpperCase());
      const couponResult = applyCoupon(coupon, subtotal);
      const total = Math.max(0, subtotal + shipping - couponResult.discount);

      const order = {
        id: makeOrderId(db.orders),
        customerId: customer.id,
        customer: customer.name,
        phone: body.phone || customer.phone,
        email: body.email || customer.email,
        address: body.address || "",
        items,
        subtotal,
        shipping,
        discount: couponResult.discount,
        coupon: couponResult.coupon,
        total,
        payMethod: body.payMethod || "COD",
        payStatus: body.payMethod === "COD" ? "pending" : "paid",
        status: "pending",
        date: new Date().toISOString().slice(0, 10),
        note: body.note || ""
      };

      db.orders.unshift(order);
      customer.orders = Number(customer.orders || 0) + 1;
      customer.totalSpent = Number(customer.totalSpent || 0) + total;
      customer.lastOrder = order.date;
      customer.cart = [];
      if (coupon) {
        coupon.uses = Number(coupon.uses || 0) + 1;
      }

      writeDb(db);
      sendJson(res, 201, order);
      return;
    }

    const orderParams = routeMatch(pathname, "/api/orders/:id");
    if (orderParams && req.method === "GET") {
      const session = getSession(db, req);
      if (!session) {
        unauthorized(res);
        return;
      }
      const order = db.orders.find(item => item.id === orderParams.id);
      if (!order) {
        notFound(res);
        return;
      }
      if (session.role === "customer" && order.customerId !== session.userId) {
        unauthorized(res, "This order does not belong to you");
        return;
      }
      sendJson(res, 200, order);
      return;
    }

    if (orderParams && req.method === "PATCH") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      const body = await readBody(req);
      const order = db.orders.find(item => item.id === orderParams.id);
      if (!order) {
        notFound(res);
        return;
      }
      order.status = body.status || order.status;
      order.payStatus = body.payStatus || order.payStatus;
      writeDb(db);
      sendJson(res, 200, order);
      return;
    }

    if (req.method === "GET" && pathname === "/api/customers") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      sendJson(res, 200, db.customers.map(publicCustomer));
      return;
    }

    if (req.method === "GET" && pathname === "/api/payments") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      const payments = db.orders.map(order => ({
        orderId: order.id,
        customer: order.customer,
        amount: order.total,
        method: order.payMethod,
        status: order.payStatus,
        date: order.date
      }));
      sendJson(res, 200, payments);
      return;
    }

    if (req.method === "GET" && pathname === "/api/analytics") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      sendJson(res, 200, summarizeAnalytics(db));
      return;
    }

    notFound(res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
}

const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`RG Store backend is running on http://localhost:${PORT}`);
});
