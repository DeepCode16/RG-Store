(function() {
  var supa = window.rgSupabase;
  var syncTimer = null;
  var syncEnabled = false;
  var labels = document.querySelectorAll(".lg label");
  var emailInput = document.getElementById("lu");
  var passwordInput = document.getElementById("lp");
  var loginHint = document.querySelector(".login-hint");
  var savedAt = document.getElementById("savedAt");

  if (labels[0]) {
    labels[0].textContent = "Admin Email";
  }
  if (emailInput && emailInput.value === "admin") {
    emailInput.value = "";
    emailInput.placeholder = "admin@example.com";
  }
  if (passwordInput && passwordInput.value === "rg1234") {
    passwordInput.value = "";
  }
  if (loginHint) {
    loginHint.textContent = supa && supa.ready
      ? "Login with your Supabase admin email and password"
      : "Fill js/supabase-config.js with your Supabase URL and anon key";
  }

  function setSavedText(text) {
    if (savedAt) {
      savedAt.textContent = text;
    }
  }

  function replaceList(target, rows) {
    target.splice(0, target.length);
    rows.forEach(function(row) {
      target.push(row);
    });
  }

  async function syncCollection(table, rows, conflictColumn) {
    var existing = await supa.client.from(table).select(conflictColumn);
    if (existing.error) {
      throw existing.error;
    }

    var existingIds = (existing.data || []).map(function(item) { return String(item[conflictColumn]); });
    var nextIds = rows.map(function(item) { return String(item[conflictColumn]); });
    var deleteIds = existingIds.filter(function(id) { return nextIds.indexOf(id) === -1; });

    if (deleteIds.length) {
      var deleteResult = await supa.client.from(table).delete().in(conflictColumn, deleteIds);
      if (deleteResult.error) {
        throw deleteResult.error;
      }
    }

    if (rows.length) {
      var upsertResult = await supa.client.from(table).upsert(rows, { onConflict: conflictColumn });
      if (upsertResult.error) {
        throw upsertResult.error;
      }
    }
  }

  async function loadRemoteDb() {
    if (!supa || !supa.ready) {
      return;
    }

    var results = await Promise.all([
      supa.client.from("store_settings").select("*").eq("id", 1).maybeSingle(),
      supa.client.from("categories").select("*").order("sort_order", { ascending: true }),
      supa.client.from("products").select("*").order("id", { ascending: true }),
      supa.client.from("orders").select("*").order("created_at", { ascending: false }),
      supa.client.from("customers").select("*").order("joined_at", { ascending: false }),
      supa.client.from("coupons").select("*").order("code", { ascending: true })
    ]);

    var error = results
      .map(function(result) { return result.error; })
      .filter(Boolean)[0];

    if (error) {
      console.error(error);
      showToast("Could not load admin data");
      return;
    }

    db.store = supa.mapStoreFromRow(results[0].data || {});
    replaceList(db.cats, (results[1].data || []).map(supa.mapCategoryFromRow));
    replaceList(db.products, (results[2].data || []).map(supa.mapProductFromRow));
    replaceList(db.orders, (results[3].data || []).map(supa.mapOrderFromRow));
    replaceList(db.customers, (results[4].data || []).map(supa.mapCustomerFromRow));
    replaceList(db.coupons, (results[5].data || []).map(supa.mapCouponFromRow));
    syncEnabled = true;
    setSavedText("Connected to Supabase");
  }

  async function pushRemoteDb() {
    if (!supa || !supa.ready || !syncEnabled) {
      return;
    }

    setSavedText("Syncing to Supabase...");
    await supa.client.from("store_settings").upsert(supa.mapStoreToRow(db.store), { onConflict: "id" });
    await syncCollection("categories", db.cats.map(supa.mapCategoryToRow), "id");
    await syncCollection("products", db.products.map(supa.mapProductToRow), "id");
    await syncCollection("orders", db.orders.map(supa.mapOrderToRow), "id");
    await syncCollection("customers", db.customers.map(supa.mapCustomerToRow), "id");
    await syncCollection("coupons", db.coupons.map(supa.mapCouponToRow), "id");
    setSavedText("Saved to Supabase at " + new Date().toLocaleTimeString());
  }

  window.save = function() {
    if (!supa || !supa.ready || !syncEnabled) {
      setSavedText("Waiting for Supabase login");
      return;
    }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function() {
      pushRemoteDb().catch(function(error) {
        console.error(error);
        setSavedText("Supabase sync failed");
        showToast("Sync failed. Check console.");
      });
    }, 350);
  };

  window.doLogin = async function() {
    if (!supa || !supa.ready) {
      showToast("Add your Supabase config first");
      return;
    }

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    if (!email || !password) {
      showToast("Enter admin email and password");
      return;
    }

    var loginResult = await supa.client.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (loginResult.error) {
      console.error(loginResult.error);
      showToast("Login failed");
      return;
    }

    var adminOk = await supa.isAdmin();
    if (!adminOk) {
      await supa.client.auth.signOut();
      showToast("This user is not marked as admin");
      return;
    }

    document.getElementById("loginPage").style.display = "none";
    document.getElementById("app").classList.add("active");
    await loadRemoteDb();
    go("dashboard");
  };

  window.doLogout = async function() {
    if (supa && supa.ready) {
      await supa.client.auth.signOut();
    }
    syncEnabled = false;
    document.getElementById("app").classList.remove("active");
    document.getElementById("loginPage").style.display = "block";
    setSavedText("");
  };

  async function restoreSession() {
    if (!supa || !supa.ready) {
      return;
    }
    var sessionResult = await supa.client.auth.getSession();
    if (!sessionResult.data || !sessionResult.data.session) {
      return;
    }
    if (!(await supa.isAdmin())) {
      await supa.client.auth.signOut();
      return;
    }
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("app").classList.add("active");
    await loadRemoteDb();
    go("dashboard");
  }

  restoreSession();
})();
