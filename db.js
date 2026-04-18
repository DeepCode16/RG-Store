"use strict";

const fs = require("fs");
const path = require("path");
const { seedData } = require("./seed");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "store.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(seedData, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

function nextId(items, field) {
  return items.reduce((max, item) => Math.max(max, Number(item[field]) || 0), 0) + 1;
}

function makeCustomerId(customers) {
  const nextNumber = customers.reduce((max, customer) => {
    const numeric = Number(String(customer.id || "").replace(/\D/g, ""));
    return Math.max(max, numeric || 0);
  }, 0) + 1;
  return `CUS${String(nextNumber).padStart(3, "0")}`;
}

function makeOrderId(orders) {
  const nextNumber = orders.reduce((max, order) => {
    const numeric = Number(String(order.id || "").replace(/\D/g, ""));
    return Math.max(max, numeric || 0);
  }, 1000) + 1;
  return `RGO-${nextNumber}`;
}

function publicCustomer(customer) {
  if (!customer) {
    return null;
  }

  const copy = clone(customer);
  delete copy.password;
  return copy;
}

module.exports = {
  clone,
  readDb,
  writeDb,
  nextId,
  makeCustomerId,
  makeOrderId,
  publicCustomer
};
