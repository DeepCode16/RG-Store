"use strict";

var http = require("http");
var crypto = require("crypto");
var urlLib = require("url");
var dbTools = require("./db");

var readDb = dbTools.readDb;
var writeDb = dbTools.writeDb;
var nextId = dbTools.nextId;
var makeCustomerId = dbTools.makeCustomerId;
var makeOrderId = dbTools.makeOrderId;
var publicCustomer = dbTools.publicCustomer;

var PORT = Number(process.env.PORT) || 4000;

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

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

function readBody(req, callback) {
  var raw = "";
  req.on("data", function(chunk) {
    raw += chunk;
    if (raw.length > 1000000) {
      callback(new Error("Payload too large"));
    }
  });
  req.on("end", function() {
    if (!raw) {
      callback(null, {});
      return;
    }
    try {
      callback(null, JSON.parse(raw));
    } catch (error) {
      callback(new Error("Invalid JSON body"));
    }
  });
  req.on("error", callback);
}

function getToken(req) {
  var auth = req.headers.authorization || "";
  if (auth.indexOf("Bearer ") !== 0) {
    return null;
  }
  return auth.slice(7);
}

function getSession(db, req) {
  var token = getToken(req);
  var i;
  if (!token) {
    return null;
  }
  for (i = 0; i < db.sessions.length; i += 1) {
    if (db.sessions[i].token === token) {
      return db.sessions[i];
    }
  }
  return null;
}

function requireAdmin(db, req, res) {
  var session = getSession(db, req);
  if (!session || session.role !== "admin") {
    unauthorized(res, "Admin login required");
    return null;
  }
  return session;
}

function requireCustomer(db, req, res) {
  var session = getSession(db, req);
  var i;
  if (!session || session.role !== "customer") {
    unauthorized(res, "Customer login required");
    return null;
  }
  for (i = 0; i < db.customers.length; i += 1) {
    if (db.customers[i].id === session.userId) {
      return db.customers[i];
    }
  }
  unauthorized(res, "Customer session is invalid");
  return null;
}

function sanitizeProduct(product) {
  var output = Object.assign({}, product);
  output.image = output.image || "";
  return output;
}

function summarizeAnalytics(db) {
  var activeCoupons = 0;
  var totalRevenue = 0;
  var pendingOrders = 0;
  var paidOrders = 0;
  var i;

  for (i = 0; i < db.coupons.length; i += 1) {
    if (db.coupons[i].active) {
      activeCoupons += 1;
    }
  }

  for (i = 0; i < db.orders.length; i += 1) {
    if (db.orders[i].status !== "cancelled") {
      totalRevenue += Number(db.orders[i].total || 0);
    }
    if (db.orders[i].status === "pending" || db.orders[i].status === "processing") {
      pendingOrders += 1;
    }
    if (db.orders[i].payStatus === "paid") {
      paidOrders += 1;
    }
  }

  return {
    products: db.products.length,
    categories: db.categories.length,
    customers: db.customers.length,
    orders: db.orders.length,
    pendingOrders: pendingOrders,
    paidOrders: paidOrders,
    activeCoupons: activeCoupons,
    totalRevenue: totalRevenue
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
  var result = [];
  var i;
  var j;
  var product;
  for (i = 0; i < items.length; i += 1) {
    product = null;
    for (j = 0; j < products.length; j += 1) {
      if (Number(products[j].id) === Number(items[i].productId)) {
        product = products[j];
        break;
      }
    }
    if (!product) {
      throw new Error("Product " + items[i].productId + " not found");
    }
    result.push({
      productId: product.id,
      name: product.name,
      qty: Number(items[i].qty || 1),
      price: Number(product.price)
    });
  }
  return result;
}

function routeMatch(pathname, pattern) {
  var actual = pathname.split("/").filter(Boolean);
  var expected = pattern.split("/").filter(Boolean);
  var params = {};
  var i;
  if (actual.length !== expected.length) {
    return null;
  }

  for (i = 0; i < expected.length; i += 1) {
    if (expected[i].charAt(0) === ":") {
      params[expected[i].slice(1)] = actual[i];
    } else if (expected[i] !== actual[i]) {
      return null;
    }
  }

  return params;
}

function findById(list, id) {
  var i;
  for (i = 0; i < list.length; i += 1) {
    if (String(list[i].id) === String(id)) {
      return list[i];
    }
  }
  return null;
}

function removeById(list, id) {
  return list.filter(function(item) {
    return String(item.id) !== String(id);
  });
}

function sendBodyError(res, error) {
  if (error) {
    badRequest(res, error.message);
    return true;
  }
  return false;
}

function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  var parsed = urlLib.parse(req.url, true);
  var pathname = parsed.pathname;
  var db = readDb();
  var params;
  var session;
  var customer;
  var product;
  var coupon;
  var existing;
  var order;

  try {
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "rg-store-backend" });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      readBody(req, function(error, body) {
        var i;
        var admin = null;
        if (sendBodyError(res, error)) {
          return;
        }
        for (i = 0; i < db.adminUsers.length; i += 1) {
          if (db.adminUsers[i].username === body.username && db.adminUsers[i].password === body.password) {
            admin = db.adminUsers[i];
            break;
          }
        }
        if (!admin) {
          unauthorized(res, "Wrong admin credentials");
          return;
        }
        db.sessions.push({ token: makeToken(), role: "admin", userId: admin.id, createdAt: new Date().toISOString() });
        writeDb(db);
        sendJson(res, 200, {
          token: db.sessions[db.sessions.length - 1].token,
          user: { id: admin.id, name: admin.name, username: admin.username, role: "admin" }
        });
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/register") {
      readBody(req, function(error, body) {
        var i;
        var newCustomer;
        if (sendBodyError(res, error)) {
          return;
        }
        if (!body.name || !body.phone || !body.password) {
          badRequest(res, "name, phone and password are required");
          return;
        }
        for (i = 0; i < db.customers.length; i += 1) {
          if (db.customers[i].phone === body.phone) {
            badRequest(res, "Phone already registered");
            return;
          }
        }
        newCustomer = {
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
        db.customers.push(newCustomer);
        db.sessions.push({ token: makeToken(), role: "customer", userId: newCustomer.id, createdAt: new Date().toISOString() });
        writeDb(db);
        sendJson(res, 201, { token: db.sessions[db.sessions.length - 1].token, user: publicCustomer(newCustomer) });
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      readBody(req, function(error, body) {
        var i;
        var loginId = body && (body.phone || body.email);
        var found = null;
        if (sendBodyError(res, error)) {
          return;
        }
        for (i = 0; i < db.customers.length; i += 1) {
          if ((db.customers[i].phone && db.customers[i].phone === loginId) || (db.customers[i].email && db.customers[i].email === loginId)) {
            found = db.customers[i];
            break;
          }
        }
        if (!found || found.password !== body.password) {
          unauthorized(res, "Wrong customer credentials");
          return;
        }
        db.sessions.push({ token: makeToken(), role: "customer", userId: found.id, createdAt: new Date().toISOString() });
        writeDb(db);
        sendJson(res, 200, { token: db.sessions[db.sessions.length - 1].token, user: publicCustomer(found) });
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/request-otp") {
      readBody(req, function(error, body) {
        var contact;
        if (sendBodyError(res, error)) {
          return;
        }
        contact = body.phone || body.email;
        if (!contact) {
          badRequest(res, "phone or email is required");
          return;
        }
        db.otpRequests.push({
          id: makeToken(),
          contact: contact,
          code: "123456",
          createdAt: new Date().toISOString()
        });
        writeDb(db);
        sendJson(res, 200, { message: "OTP generated for demo", otp: "123456" });
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login-otp") {
      readBody(req, function(error, body) {
        var i;
        var contact;
        var otpOk = false;
        var found = null;
        if (sendBodyError(res, error)) {
          return;
        }
        contact = body.phone || body.email;
        for (i = 0; i < db.otpRequests.length; i += 1) {
          if (db.otpRequests[i].contact === contact && db.otpRequests[i].code === body.otp) {
            otpOk = true;
            break;
          }
        }
        if (!otpOk) {
          unauthorized(res, "Invalid OTP");
          return;
        }
        for (i = 0; i < db.customers.length; i += 1) {
          if (db.customers[i].phone === contact || db.customers[i].email === contact) {
            found = db.customers[i];
            break;
          }
        }
        if (!found) {
          unauthorized(res, "Customer not found for OTP");
          return;
        }
        db.sessions.push({ token: makeToken(), role: "customer", userId: found.id, createdAt: new Date().toISOString() });
        writeDb(db);
        sendJson(res, 200, { token: db.sessions[db.sessions.length - 1].token, user: publicCustomer(found) });
      });
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
      readBody(req, function(error, body) {
        if (sendBodyError(res, error)) {
          return;
        }
        db.store = Object.assign({}, db.store, body);
        writeDb(db);
        sendJson(res, 200, db.store);
      });
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
      readBody(req, function(error, body) {
        var category;
        if (sendBodyError(res, error)) {
          return;
        }
        if (!body.id || !body.name) {
          badRequest(res, "id and name are required");
          return;
        }
        category = { id: body.id, name: body.name, emoji: body.emoji || "🏷️" };
        db.categories.push(category);
        writeDb(db);
        sendJson(res, 201, category);
      });
      return;
    }

    params = routeMatch(pathname, "/api/categories/:id");
    if (params && req.method === "DELETE") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      db.categories = removeById(db.categories, params.id);
      writeDb(db);
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/products") {
      var category = parsed.query.category;
      var search = String(parsed.query.search || "").toLowerCase();
      var stock = parsed.query.stock;
      var products = db.products.map(sanitizeProduct).filter(function(item) {
        var searchOk;
        if (category && category !== "all" && item.cat !== category) {
          return false;
        }
        if (stock === "in" && !item.stock) {
          return false;
        }
        if (stock === "out" && item.stock) {
          return false;
        }
        if (!search) {
          return true;
        }
        searchOk = item.name.toLowerCase().indexOf(search) > -1 ||
          String(item.brand || "").toLowerCase().indexOf(search) > -1 ||
          String(item.cat || "").toLowerCase().indexOf(search) > -1;
        return searchOk;
      });
      sendJson(res, 200, products);
      return;
    }

    if (req.method === "POST" && pathname === "/api/products") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      readBody(req, function(error, body) {
        var newProduct;
        if (sendBodyError(res, error)) {
          return;
        }
        newProduct = sanitizeProduct({
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
        db.products.unshift(newProduct);
        writeDb(db);
        sendJson(res, 201, newProduct);
      });
      return;
    }

    params = routeMatch(pathname, "/api/products/:id");
    if (params && req.method === "GET") {
      product = findById(db.products, params.id);
      if (!product) {
        notFound(res);
        return;
      }
      sendJson(res, 200, sanitizeProduct(product));
      return;
    }

    if (params && req.method === "PUT") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      readBody(req, function(error, body) {
        var i;
        if (sendBodyError(res, error)) {
          return;
        }
        for (i = 0; i < db.products.length; i += 1) {
          if (String(db.products[i].id) === String(params.id)) {
            db.products[i] = sanitizeProduct(Object.assign({}, db.products[i], body, { id: db.products[i].id }));
            writeDb(db);
            sendJson(res, 200, db.products[i]);
            return;
          }
        }
        notFound(res);
      });
      return;
    }

    if (params && req.method === "DELETE") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      db.products = removeById(db.products, params.id);
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
      readBody(req, function(error, body) {
        var newCoupon;
        if (sendBodyError(res, error)) {
          return;
        }
        newCoupon = {
          id: body.id || ("c" + (db.coupons.length + 1)),
          code: String(body.code || "").toUpperCase(),
          type: body.type || "percent",
          value: Number(body.value || 0),
          minOrder: Number(body.minOrder || 0),
          active: body.active !== false,
          uses: Number(body.uses || 0),
          desc: body.desc || ""
        };
        db.coupons.push(newCoupon);
        writeDb(db);
        sendJson(res, 201, newCoupon);
      });
      return;
    }

    params = routeMatch(pathname, "/api/coupons/:id");
    if (params && req.method === "PUT") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      readBody(req, function(error, body) {
        var i;
        if (sendBodyError(res, error)) {
          return;
        }
        for (i = 0; i < db.coupons.length; i += 1) {
          if (String(db.coupons[i].id) === String(params.id)) {
            db.coupons[i] = Object.assign({}, db.coupons[i], body);
            writeDb(db);
            sendJson(res, 200, db.coupons[i]);
            return;
          }
        }
        notFound(res);
      });
      return;
    }

    if (params && req.method === "DELETE") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      db.coupons = removeById(db.coupons, params.id);
      writeDb(db);
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/me") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      sendJson(res, 200, publicCustomer(customer));
      return;
    }

    if (req.method === "GET" && pathname === "/api/me/wishlist") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      sendJson(res, 200, (customer.wishlist || []).map(function(id) {
        return findById(db.products, id);
      }).filter(Boolean).map(sanitizeProduct));
      return;
    }

    if (req.method === "POST" && pathname === "/api/me/wishlist") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      readBody(req, function(error, body) {
        var productId;
        if (sendBodyError(res, error)) {
          return;
        }
        productId = Number(body.productId);
        customer.wishlist = customer.wishlist || [];
        if (customer.wishlist.indexOf(productId) === -1) {
          customer.wishlist.push(productId);
        }
        writeDb(db);
        sendJson(res, 200, { success: true, wishlist: customer.wishlist });
      });
      return;
    }

    params = routeMatch(pathname, "/api/me/wishlist/:productId");
    if (params && req.method === "DELETE") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      customer.wishlist = (customer.wishlist || []).filter(function(id) {
        return Number(id) !== Number(params.productId);
      });
      writeDb(db);
      sendJson(res, 200, { success: true, wishlist: customer.wishlist });
      return;
    }

    if (req.method === "GET" && pathname === "/api/me/cart") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      sendJson(res, 200, customer.cart || []);
      return;
    }

    if (req.method === "POST" && pathname === "/api/me/cart") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      readBody(req, function(error, body) {
        if (sendBodyError(res, error)) {
          return;
        }
        product = findById(db.products, Number(body.productId));
        if (!product) {
          notFound(res);
          return;
        }
        customer.cart = customer.cart || [];
        existing = null;
        customer.cart.forEach(function(item) {
          if (Number(item.productId) === Number(product.id)) {
            existing = item;
          }
        });
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
      });
      return;
    }

    params = routeMatch(pathname, "/api/me/cart/:productId");
    if (params && req.method === "PATCH") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      readBody(req, function(error, body) {
        var found = null;
        if (sendBodyError(res, error)) {
          return;
        }
        (customer.cart || []).forEach(function(item) {
          if (Number(item.productId) === Number(params.productId)) {
            found = item;
          }
        });
        if (!found) {
          notFound(res);
          return;
        }
        found.qty = Math.max(1, Number(body.qty || 1));
        writeDb(db);
        sendJson(res, 200, customer.cart);
      });
      return;
    }

    if (params && req.method === "DELETE") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      customer.cart = (customer.cart || []).filter(function(item) {
        return Number(item.productId) !== Number(params.productId);
      });
      writeDb(db);
      sendJson(res, 200, customer.cart);
      return;
    }

    if (req.method === "GET" && pathname === "/api/orders") {
      session = getSession(db, req);
      if (session && session.role === "customer") {
        sendJson(res, 200, db.orders.filter(function(item) {
          return item.customerId === session.userId;
        }));
        return;
      }
      if (!requireAdmin(db, req, res)) {
        return;
      }
      sendJson(res, 200, db.orders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/orders") {
      customer = requireCustomer(db, req, res);
      if (!customer) {
        return;
      }
      readBody(req, function(error, body) {
        var sourceItems;
        var items;
        var subtotal;
        var shipping;
        var couponResult;
        var total;
        var i;
        if (sendBodyError(res, error)) {
          return;
        }
        sourceItems = body.items && body.items.length ? body.items : customer.cart;
        if (!sourceItems || !sourceItems.length) {
          badRequest(res, "Cart is empty");
          return;
        }
        items = buildOrderItems(db.products, sourceItems);
        subtotal = items.reduce(function(sum, item) {
          return sum + (item.price * item.qty);
        }, 0);
        shipping = subtotal >= Number(db.store.shippingFree || 0) ? 0 : 60;
        coupon = null;
        for (i = 0; i < db.coupons.length; i += 1) {
          if (db.coupons[i].code === String(body.couponCode || "").toUpperCase()) {
            coupon = db.coupons[i];
            break;
          }
        }
        couponResult = applyCoupon(coupon, subtotal);
        total = Math.max(0, subtotal + shipping - couponResult.discount);
        order = {
          id: makeOrderId(db.orders),
          customerId: customer.id,
          customer: customer.name,
          phone: body.phone || customer.phone,
          email: body.email || customer.email,
          address: body.address || "",
          items: items,
          subtotal: subtotal,
          shipping: shipping,
          discount: couponResult.discount,
          coupon: couponResult.coupon,
          total: total,
          payMethod: body.payMethod || "COD",
          payStatus: body.payMethod === "COD" || !body.payMethod ? "pending" : "paid",
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
      });
      return;
    }

    params = routeMatch(pathname, "/api/orders/:id");
    if (params && req.method === "GET") {
      session = getSession(db, req);
      order = findById(db.orders, params.id);
      if (!session) {
        unauthorized(res);
        return;
      }
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

    if (params && req.method === "PATCH") {
      if (!requireAdmin(db, req, res)) {
        return;
      }
      readBody(req, function(error, body) {
        var foundOrder = findById(db.orders, params.id);
        if (sendBodyError(res, error)) {
          return;
        }
        if (!foundOrder) {
          notFound(res);
          return;
        }
        foundOrder.status = body.status || foundOrder.status;
        foundOrder.payStatus = body.payStatus || foundOrder.payStatus;
        writeDb(db);
        sendJson(res, 200, foundOrder);
      });
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
      sendJson(res, 200, db.orders.map(function(item) {
        return {
          orderId: item.id,
          customer: item.customer,
          amount: item.total,
          method: item.payMethod,
          status: item.payStatus,
          date: item.date
        };
      }));
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

http.createServer(handleRequest).listen(PORT, function() {
  console.log("RG Store backend is running on http://localhost:" + PORT);
});
