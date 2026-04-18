(function() {
  var supa = window.rgSupabase;
  var storeSettings = {
    shippingFree: 2000
  };
  var currentCustomerRow = null;

  window.getFreeShippingAmount = function() {
    return Number(storeSettings.shippingFree || 2000);
  };

  function customerDisplayNameFromEmail(email) {
    return String(email || "")
      .split("@")[0]
      .replace(/[._]/g, " ")
      .replace(/\b\w/g, function(ch) { return ch.toUpperCase(); });
  }

  function getAuthRedirectUrl() {
    if (window.location.protocol === "file:") {
      return null;
    }
    return window.location.origin + window.location.pathname;
  }

  function setProducts(products) {
    PRODUCTS.splice(0, PRODUCTS.length);
    products.forEach(function(product) {
      PRODUCTS.push(product);
    });
  }

  function renderCategoryBar(categories) {
    var catBar = document.getElementById("catBar");
    if (!catBar) {
      return;
    }
    catBar.innerHTML =
      '<div class="cat-item active" onclick="filterCat(\'all\',this)"><span class="cat-icon">🏪</span>All</div>' +
      categories
        .map(function(category) {
          return (
            '<div class="cat-item" onclick="filterCat(\'' +
            category.id +
            "',this)\"><span class=\"cat-icon\">" +
            (category.emoji || "📦") +
            "</span>" +
            category.name +
            "</div>"
          );
        })
        .join("");
  }

  function updateStoreText(store) {
    if (!store) {
      return;
    }
    storeSettings = store;
    document.title = store.name ? store.name : document.title;
    document.querySelectorAll(".logo").forEach(function(logo) {
      logo.innerHTML = "<span>RG</span> " + (store.name || "Store");
    });
    var hero = document.querySelector(".hero-banner h1");
    if (hero) {
      hero.innerHTML = (store.tagline || "Quality Agricultural Hand Tools").replace(" ", "<br>");
    }
    var search = document.getElementById("searchInput");
    if (search) {
      search.placeholder = "Search " + (store.name || "products") + " products...";
    }
    document.querySelectorAll(".offer-sub").forEach(function(sub) {
      if (sub.textContent.indexOf("orders above") !== -1) {
        sub.textContent = "On orders above ₹" + window.getFreeShippingAmount();
      }
    });
  }

  async function loadRemoteStore() {
    if (!supa || !supa.ready) {
      console.warn("Supabase config missing. Store page is using demo data.");
      return;
    }

    var results = await Promise.all([
      supa.client.from("store_settings").select("*").eq("id", 1).maybeSingle(),
      supa.client.from("categories").select("*").order("sort_order", { ascending: true }),
      supa.client.from("products").select("*").eq("is_active", true).order("id", { ascending: true })
    ]);

    var storeResult = results[0];
    var categoryResult = results[1];
    var productResult = results[2];

    if (storeResult.error || categoryResult.error || productResult.error) {
      console.error(storeResult.error || categoryResult.error || productResult.error);
      showToast("Could not load online store data");
      return;
    }

    var categories = (categoryResult.data || []).map(supa.mapCategoryFromRow);
    var products = (productResult.data || []).map(supa.mapProductFromRow);
    setProducts(products);
    renderCategoryBar(categories);
    updateStoreText(supa.mapStoreFromRow(storeResult.data || {}));
    renderProducts(PRODUCTS);
    updateBadges();
  }

  function buildAddressText(address) {
    if (!address) {
      return "";
    }
    return [address.line, address.city, address.state, address.pin].filter(Boolean).join(", ");
  }

  function updateCustomerSnapshot(order) {
    var city = "";
    if (order.address && order.address.city) {
      city = order.address.city;
    }
    if (currentCustomerRow && currentCustomerRow.auth_user_id) {
      return supa.client
        .from("customers")
        .update({
          name: order.customer,
          phone: order.phone,
          email: order.email,
          city: city,
          state_text: (order.address && order.address.state) || "",
          orders_count: Number((currentCustomerRow && currentCustomerRow.orders_count) || 0) + 1,
          total_spent: Number((currentCustomerRow && currentCustomerRow.total_spent) || 0) + Number(order.total || 0),
          last_order_at: new Date().toISOString()
        })
        .eq("id", currentCustomerRow.id)
        .select("*")
        .maybeSingle()
        .then(function(result) {
          if (result.data) {
            currentCustomerRow = result.data;
          }
          return result;
        });
    }
    return supa.client
      .from("customers")
      .select("*")
      .eq("phone", order.phone)
      .maybeSingle()
      .then(function(result) {
        var existing = result.data;
        return supa.client
          .from("customers")
          .upsert(
            {
              id: existing ? existing.id : undefined,
              auth_user_id: existing ? existing.auth_user_id : null,
              phone: order.phone,
              name: order.customer,
              email: order.email,
              city: city,
              state_text: (order.address && order.address.state) || "",
              joined_at: existing ? existing.joined_at : new Date().toISOString(),
              orders_count: Number((existing && existing.orders_count) || 0) + 1,
              total_spent: Number((existing && existing.total_spent) || 0) + Number(order.total || 0),
              last_order_at: new Date().toISOString()
            },
            { onConflict: "phone" }
          );
      });
  }

  function syncStateFromCustomer(row, orders) {
    currentCustomerRow = row || null;
    if (!row) {
      state.user = null;
      state.wishlist = [];
      state.orders = [];
      state.checkoutAddress = null;
      updateBadges();
      return;
    }

    state.user = {
      id: row.auth_user_id || row.id,
      customerId: row.id,
      name: row.name || customerDisplayNameFromEmail(row.email),
      email: row.email || "",
      phone: row.phone || "",
      businessName: row.business_name || "",
      gstNumber: row.gst_number || "",
      stateName: row.state_text || ""
    };
    state.wishlist = (Array.isArray(row.wishlist) ? row.wishlist : [])
      .map(function(id) {
        return PRODUCTS.find(function(product) { return Number(product.id) === Number(id); });
      })
      .filter(Boolean);
    state.orders = (orders || []).map(function(orderRow) {
      return {
        id: orderRow.id,
        date: new Date(orderRow.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        items: Array.isArray(orderRow.items) ? orderRow.items : [],
        address: {
          line: orderRow.address_text,
          city: row.city || "",
          state: row.state_text || "",
          pin: "",
          type: "Home",
          name: row.name || "",
          phone: row.phone || ""
        },
        payment: orderRow.pay_method,
        total: Number(orderRow.total || 0),
        status: orderRow.status || "pending",
        estimatedDelivery: getDeliveryDate()
      };
    });
    var addresses = Array.isArray(row.addresses) ? row.addresses : [];
    state.checkoutAddress = addresses.length ? addresses[0] : null;
    updateBadges();
  }

  async function ensureCustomerProfile(user, extra) {
    extra = extra || {};
    var existing = await supa.client
      .from("customers")
      .select("*")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (existing.error) {
      throw existing.error;
    }

    if (existing.data) {
      return existing.data;
    }

    var fallback = null;
    if (user.email) {
      fallback = await supa.client.from("customers").select("*").eq("email", user.email).maybeSingle();
      if (fallback.error) {
        throw fallback.error;
      }
    }

    var payload = {
      auth_user_id: user.id,
      name: extra.name || (fallback.data && fallback.data.name) || customerDisplayNameFromEmail(user.email),
      email: user.email || "",
      phone: extra.phone || (fallback.data && fallback.data.phone) || "",
      city: (fallback.data && fallback.data.city) || "",
      state_text: (fallback.data && fallback.data.state_text) || "",
      business_name: (fallback.data && fallback.data.business_name) || "",
      gst_number: (fallback.data && fallback.data.gst_number) || "",
      wishlist: (fallback.data && fallback.data.wishlist) || [],
      addresses: (fallback.data && fallback.data.addresses) || [],
      joined_at: (fallback.data && fallback.data.joined_at) || new Date().toISOString(),
      orders_count: Number((fallback.data && fallback.data.orders_count) || 0),
      total_spent: Number((fallback.data && fallback.data.total_spent) || 0),
      last_order_at: (fallback.data && fallback.data.last_order_at) || null
    };

    if (fallback.data) {
      payload.id = fallback.data.id;
    }

    var upsert = await supa.client
      .from("customers")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (upsert.error) {
      throw upsert.error;
    }

    return upsert.data;
  }

  async function loadSignedInCustomer() {
    if (!supa || !supa.ready) {
      return;
    }
    var authResult = await supa.client.auth.getUser();
    var user = authResult.data && authResult.data.user;
    if (!user) {
      syncStateFromCustomer(null, []);
      return;
    }

    var profile = await ensureCustomerProfile(user);
    var ordersResult = await supa.client
      .from("orders")
      .select("*")
      .eq("auth_user_id", user.id)
      .order("created_at", { ascending: false });
    if (ordersResult.error) {
      throw ordersResult.error;
    }
    syncStateFromCustomer(profile, ordersResult.data || []);
  }

  async function saveCustomerProfile(patch) {
    if (!supa || !supa.ready || !currentCustomerRow) {
      return;
    }
    var payload = Object.assign({}, currentCustomerRow, patch || {});
    var result = await supa.client
      .from("customers")
      .update(payload)
      .eq("id", currentCustomerRow.id)
      .select("*")
      .single();
    if (result.error) {
      throw result.error;
    }
    currentCustomerRow = result.data;
    return result.data;
  }

  window.sendOTP = async function(type) {
    if (!supa || !supa.ready) {
      showToast("Add your Supabase config first");
      return;
    }

    var isSignup = type === "signup";
    var email = document.getElementById(isSignup ? "signupEmail" : "loginEmail").value.trim();
    if (!email) {
      showToast("Enter email first");
      return;
    }

    var options = {
      shouldCreateUser: isSignup,
      emailRedirectTo: getAuthRedirectUrl()
    };

    if (isSignup) {
      options.data = {
        full_name: document.getElementById("signupName").value.trim(),
        phone: document.getElementById("signupPhone").value.trim()
      };
    }

    var result = await supa.client.auth.signInWithOtp({
      email: email,
      options: options
    });

    if (result.error) {
      console.error(result.error);
      showToast(result.error.message || "Could not send OTP");
      return;
    }

    showToast("OTP sent to Gmail. Check your email.");
  };

  window.googleLogin = async function() {
    if (!supa || !supa.ready) {
      showToast("Add your Supabase config first");
      return;
    }
    if (window.location.protocol === "file:") {
      showToast("Google login needs localhost or a real website URL");
      return;
    }
    var result = await supa.client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthRedirectUrl()
      }
    });
    if (result.error) {
      console.error(result.error);
      showToast(result.error.message || "Google login failed");
    }
  };

  window.doLogin = async function() {
    if (!supa || !supa.ready) {
      showToast("Add your Supabase config first");
      return;
    }
    var email = document.getElementById("loginEmail").value.trim();
    var pwd = document.getElementById("loginPwd").value;
    var otp = document.getElementById("loginOtp").value.trim();
    var result;

    if (otp) {
      result = await supa.client.auth.verifyOtp({
        email: email,
        token: otp,
        type: "email"
      });
    } else {
      if (!email || !pwd) {
        showToast("Enter email/password or email/OTP");
        return;
      }
      result = await supa.client.auth.signInWithPassword({ email: email, password: pwd });
    }
    if (result.error) {
      console.error(result.error);
      showToast(result.error.message || "Login failed");
      return;
    }
    await loadSignedInCustomer();
    showToast("Logged in");
    afterLoginRedirect();
  };

  window.doSignup = async function() {
    if (!supa || !supa.ready) {
      showToast("Add your Supabase config first");
      return;
    }
    var name = document.getElementById("signupName").value.trim();
    var email = document.getElementById("signupEmail").value.trim();
    var phone = document.getElementById("signupPhone").value.trim();
    var password = document.getElementById("signupPwd").value;
    var otp = document.getElementById("signupOtp").value.trim();
    if (!name || !email || !phone) {
      showToast("Fill name, email, and phone");
      return;
    }

    var result;
    if (otp) {
      result = await supa.client.auth.verifyOtp({
        email: email,
        token: otp,
        type: "email"
      });
    } else {
      if (!password) {
        showToast("Enter password or use OTP");
        return;
      }
      result = await supa.client.auth.signUp({
        email: email,
        password: password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: {
            full_name: name,
            phone: phone
          }
        }
      });
    }
    if (result.error) {
      console.error(result.error);
      showToast(result.error.message || "Signup failed");
      return;
    }
    if (result.data && result.data.user) {
      await ensureCustomerProfile(result.data.user, { name: name, phone: phone });
    }
    if (!result.data.session) {
      showToast("Account created. Check your email to confirm, then login.");
      switchTab("login");
      document.getElementById("loginEmail").value = email;
      return;
    }
    await loadSignedInCustomer();
    showToast("Account created");
    afterLoginRedirect();
  };

  window.doLogout = async function() {
    if (supa && supa.ready) {
      await supa.client.auth.signOut();
    }
    syncStateFromCustomer(null, []);
    goPage("home");
    showToast("Logged out");
  };

  window.toggleWish = function(event, id) {
    if (event) {
      event.stopPropagation();
    }
    if (!state.user) {
      state.afterLoginPage = "wishlist";
      goPage("login");
      return;
    }
    var product = PRODUCTS.find(function(item) { return item.id === id; });
    var idx = state.wishlist.findIndex(function(item) { return item.id === id; });
    if (idx > -1) {
      state.wishlist.splice(idx, 1);
      showToast("Removed from wishlist");
    } else if (product) {
      state.wishlist.push(product);
      showToast("Added to wishlist");
    }
    updateBadges();
    var wishIds = state.wishlist.map(function(item) { return item.id; });
    saveCustomerProfile({ wishlist: wishIds }).catch(function(error) {
      console.error(error);
      showToast("Could not save wishlist");
    });
    renderProducts(PRODUCTS);
    var wb = document.getElementById("wishBtn");
    if (wb) {
      wb.innerHTML = state.wishlist.find(function(item) { return item.id === id; }) ? "❤️ Wishlisted" : "🤍 Wishlist";
    }
  };

  window.removeWish = function(id) {
    state.wishlist = state.wishlist.filter(function(item) { return item.id !== id; });
    updateBadges();
    switchAcct("wishlist");
    saveCustomerProfile({ wishlist: state.wishlist.map(function(item) { return item.id; }) }).catch(function(error) {
      console.error(error);
      showToast("Could not save wishlist");
    });
  };

  window.saveModalAddress = function() {
    var name = document.getElementById("ma_name").value.trim();
    var phone = document.getElementById("ma_phone").value.trim();
    var line = document.getElementById("ma_line").value.trim();
    var city = document.getElementById("ma_city").value.trim();
    var pin = document.getElementById("ma_pin").value.trim();
    if (!name || !phone || !line || !city || !pin) {
      showToast("Fill all fields");
      return;
    }
    state.checkoutAddress = { name: name, phone: phone, line: line, city: city, state: "", pin: pin, type: document.getElementById("ma_type").value };
    closeModal();
    switchAcct("addresses");
    showToast("Address saved");
    saveCustomerProfile({
      phone: phone,
      city: city,
      addresses: [state.checkoutAddress]
    }).catch(function(error) {
      console.error(error);
      showToast("Could not save address");
    });
  };

  window.saveProfile = function() {
    var fn = document.getElementById("pf_fname").value.trim();
    var ln = document.getElementById("pf_lname").value.trim();
    var fullName = (fn + " " + ln).trim();
    state.user.name = fullName;
    state.user.email = document.getElementById("pf_email").value.trim();
    state.user.phone = document.getElementById("pf_phone").value.trim();
    state.user.businessName = document.getElementById("pf_biz").value.trim();
    state.user.gstNumber = document.getElementById("pf_gst").value.trim();
    state.user.stateName = document.getElementById("pf_state").value;
    document.getElementById("acctName").textContent = state.user.name;
    document.getElementById("acctEmail").textContent = state.user.email;
    saveCustomerProfile({
      name: state.user.name,
      email: state.user.email,
      phone: state.user.phone,
      business_name: state.user.businessName,
      gst_number: state.user.gstNumber,
      state_text: state.user.stateName
    }).then(function() {
      showToast("Profile saved");
    }).catch(function(error) {
      console.error(error);
      showToast("Could not save profile");
    });
  };

  window.cancelOrder = function(id) {
    var localOrder = state.orders.find(function(item) { return item.id === id; });
    if (!localOrder) {
      return;
    }
    localOrder.status = "cancelled";
    switchAcct("orders");
    showToast("Order cancelled");
    if (!supa || !supa.ready) {
      return;
    }
    supa.client
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", id)
      .then(function(result) {
        if (result.error) {
          console.error(result.error);
          showToast("Could not update order");
        }
      });
  };

  window.placeOrder = async function() {
    var payMethodMap = {
      cod: "COD",
      upi: "UPI",
      card: "Card",
      net: "Net Banking"
    };
    var subtotal = state.cart.reduce(function(sum, item) { return sum + item.price * item.qty; }, 0);
    var shipping = subtotal >= window.getFreeShippingAmount() ? 0 : 99;
    var oid = "RG" + Date.now().toString().slice(-8);
    var addressText = buildAddressText(state.checkoutAddress);
    var orderPayload = {
      id: oid,
      auth_user_id: state.user ? state.user.id : null,
      customer_name: state.user ? state.user.name : (state.checkoutAddress && state.checkoutAddress.name) || "Customer",
      phone: (state.user && state.user.phone) || (state.checkoutAddress && state.checkoutAddress.phone) || "",
      email: (state.user && state.user.email) || "",
      address_text: addressText,
      items: state.cart.map(function(item) {
        return {
          productId: item.id,
          name: item.name,
          qty: item.qty,
          price: item.price
        };
      }),
      subtotal: subtotal,
      shipping: shipping,
      discount: 0,
      total: subtotal + shipping,
      pay_method: payMethodMap[state.selectedPayment] || "COD",
      pay_status: state.selectedPayment === "cod" ? "pending" : "paid",
      status: "pending",
      note: "",
      created_at: new Date().toISOString()
    };

    if (supa && supa.ready) {
      var orderResult = await supa.client.from("orders").insert(orderPayload);
      if (orderResult.error) {
        console.error(orderResult.error);
        showToast("Could not place order online");
        return;
      }
      if (orderPayload.phone) {
        await updateCustomerSnapshot({
          customer: orderPayload.customer_name,
          phone: orderPayload.phone,
          email: orderPayload.email,
          total: orderPayload.total,
          address: state.checkoutAddress
        });
      }
    }

    var order = {
      id: oid,
      date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      items: state.cart.slice(),
      address: state.checkoutAddress,
      payment: state.selectedPayment,
      total: subtotal + shipping,
      status: "processing",
      estimatedDelivery: getDeliveryDate()
    };

    state.orders.unshift(order);
    state.cart = [];
    state.checkoutStep = 1;
    updateBadges();
    renderSuccess(order);
    goPage("success");
  };

  loadRemoteStore();
  if (supa && supa.ready) {
    loadSignedInCustomer().catch(function(error) {
      console.error(error);
    });
  }
})();
