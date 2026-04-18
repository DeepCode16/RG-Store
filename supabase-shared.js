(function() {
  var config = window.RG_SUPABASE_CONFIG || {};
  var hasUrl = typeof config.url === "string" && config.url.indexOf("YOUR-PROJECT") === -1;
  var hasKey = typeof config.anonKey === "string" && config.anonKey.indexOf("YOUR-ANON-KEY") === -1;
  var ready = Boolean(window.supabase && hasUrl && hasKey);
  var client = ready
    ? window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function mapStoreFromRow(row) {
    var phones = Array.isArray(row && row.phone_numbers) ? row.phone_numbers : [];
    return {
      name: (row && row.name) || "RG Store",
      tagline: (row && row.tagline) || "Quality Agricultural Hand Tools",
      phone: phones.join(", "),
      email: (row && row.email) || "",
      whatsapp: (row && row.whatsapp) || "",
      shippingFree: Number((row && row.shipping_free) || 2000)
    };
  }

  function mapStoreToRow(store) {
    var phones = String(store.phone || "")
      .split(",")
      .map(function(item) { return item.trim(); })
      .filter(Boolean);
    return {
      id: 1,
      name: store.name || "RG Store",
      tagline: store.tagline || "",
      phone_numbers: phones,
      email: store.email || "",
      whatsapp: store.whatsapp || "",
      shipping_free: Number(store.shippingFree || 0)
    };
  }

  function mapCategoryFromRow(row) {
    return {
      id: row.id,
      name: row.name,
      emoji: row.emoji || "📦"
    };
  }

  function mapCategoryToRow(category, index) {
    return {
      id: category.id,
      name: category.name,
      emoji: category.emoji || "📦",
      sort_order: index
    };
  }

  function mapProductFromRow(row) {
    return {
      id: Number(row.id),
      name: row.name,
      cat: row.category_id,
      emoji: row.emoji || "📦",
      image: row.image_url || "",
      price: Number(row.price || 0),
      mrp: Number(row.mrp || 0),
      brand: row.brand || "",
      weight: row.weight || "",
      material: row.material || "",
      size: row.size || "",
      tag: row.tag || "",
      stock: Boolean(row.in_stock),
      desc: row.description || "",
      specs: ensureArray(row.specs),
      rating: Number(row.rating || 0),
      reviews: Number(row.reviews || 0)
    };
  }

  function mapProductToRow(product) {
    return {
      id: Number(product.id),
      name: product.name || "",
      category_id: product.cat || "",
      emoji: product.emoji || "📦",
      image_url: product.image || "",
      price: Number(product.price || 0),
      mrp: Number(product.mrp || 0),
      brand: product.brand || "",
      weight: product.weight || "",
      material: product.material || "",
      size: product.size || "",
      tag: product.tag || "",
      in_stock: Boolean(product.stock),
      description: product.desc || "",
      specs: clone(ensureArray(product.specs)),
      rating: Number(product.rating || 0),
      reviews: Number(product.reviews || 0),
      is_active: true
    };
  }

  function mapCouponFromRow(row) {
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      value: Number(row.value || 0),
      minOrder: Number(row.min_order || 0),
      active: Boolean(row.active),
      uses: Number(row.uses || 0),
      desc: row.description || ""
    };
  }

  function mapCouponToRow(coupon) {
    return {
      id: coupon.id,
      code: coupon.code || "",
      type: coupon.type || "percent",
      value: Number(coupon.value || 0),
      min_order: Number(coupon.minOrder || 0),
      active: Boolean(coupon.active),
      uses: Number(coupon.uses || 0),
      description: coupon.desc || ""
    };
  }

  function formatDateOnly(value) {
    if (!value) {
      return "";
    }
    return new Date(value).toISOString().slice(0, 10);
  }

  function mapCustomerFromRow(row) {
    return {
      id: row.id,
      name: row.name || "",
      phone: row.phone || "",
      email: row.email || "",
      city: row.city || "",
      joined: formatDateOnly(row.joined_at),
      orders: Number(row.orders_count || 0),
      totalSpent: Number(row.total_spent || 0),
      lastOrder: formatDateOnly(row.last_order_at)
    };
  }

  function mapCustomerToRow(customer) {
    return {
      id: customer.id,
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      city: customer.city || "",
      joined_at: customer.joined || new Date().toISOString(),
      orders_count: Number(customer.orders || 0),
      total_spent: Number(customer.totalSpent || 0),
      last_order_at: customer.lastOrder || null
    };
  }

  function mapOrderFromRow(row) {
    return {
      id: row.id,
      customer: row.customer_name || "",
      phone: row.phone || "",
      email: row.email || "",
      address: row.address_text || "",
      items: ensureArray(row.items),
      subtotal: Number(row.subtotal || 0),
      shipping: Number(row.shipping || 0),
      discount: Number(row.discount || 0),
      total: Number(row.total || 0),
      payMethod: row.pay_method || "COD",
      payStatus: row.pay_status || "pending",
      status: row.status || "pending",
      date: formatDateOnly(row.created_at),
      note: row.note || ""
    };
  }

  function mapOrderToRow(order) {
    return {
      id: order.id,
      customer_name: order.customer || "",
      phone: order.phone || "",
      email: order.email || "",
      address_text: order.address || "",
      items: clone(ensureArray(order.items)),
      subtotal: Number(order.subtotal || 0),
      shipping: Number(order.shipping || 0),
      discount: Number(order.discount || 0),
      total: Number(order.total || 0),
      pay_method: order.payMethod || "COD",
      pay_status: order.payStatus || "pending",
      status: order.status || "pending",
      note: order.note || "",
      created_at: order.date || new Date().toISOString()
    };
  }

  async function isAdmin() {
    if (!ready) {
      return false;
    }
    var authResponse = await client.auth.getUser();
    var user = authResponse.data && authResponse.data.user;
    if (!user) {
      return false;
    }
    var result = await client
      .from("admin_profiles")
      .select("id,is_active")
      .eq("id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    return Boolean(result.data);
  }

  window.rgSupabase = {
    ready: ready,
    client: client,
    mapStoreFromRow: mapStoreFromRow,
    mapStoreToRow: mapStoreToRow,
    mapCategoryFromRow: mapCategoryFromRow,
    mapCategoryToRow: mapCategoryToRow,
    mapProductFromRow: mapProductFromRow,
    mapProductToRow: mapProductToRow,
    mapCouponFromRow: mapCouponFromRow,
    mapCouponToRow: mapCouponToRow,
    mapCustomerFromRow: mapCustomerFromRow,
    mapCustomerToRow: mapCustomerToRow,
    mapOrderFromRow: mapOrderFromRow,
    mapOrderToRow: mapOrderToRow,
    isAdmin: isAdmin
  };
})();
