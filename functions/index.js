const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

initializeApp();

const db = getFirestore();

const REGION = "asia-south1";

// DRIVER REGISTRATION
exports.registerDriver = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "पहले Login करें।");
    }

    const uid = request.auth.uid;
    const name = String(request.data.name || "").trim();
    const phone = String(request.data.phone || "").trim();

    if (name.length < 2 || name.length > 80) {
      throw new HttpsError("invalid-argument", "सही नाम लिखें।");
    }

    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      throw new HttpsError("invalid-argument", "सही 10 अंकों का मोबाइल नंबर लिखें।");
    }

    const driverRef = db.collection("drivers").doc(uid);
    const existing = await driverRef.get();

    if (existing.exists) {
      return {
        success: true,
        driverId: existing.data().driverPublicId
      };
    }

    let driverId;
    let codeRef;
    let codeExists = true;

    while (codeExists) {
      driverId = "DR-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      codeRef = db.collection("driverCodes").doc(driverId);
      const codeDoc = await codeRef.get();
      codeExists = codeDoc.exists;
    }

    const batch = db.batch();

    batch.set(driverRef, {
      uid,
      name,
      phone,
      driverPublicId: driverId,
      active: true,
      createdAt: FieldValue.serverTimestamp()
    });

    batch.set(codeRef, {
      uid,
      active: true,
      createdAt: FieldValue.serverTimestamp()
    });

    await batch.commit();

    return {
      success: true,
      driverId
    };
  }
);

// ASSIGN DRIVER TO VEHICLE
exports.assignDriverToVehicle = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "पहले Login करें।");
    }

    const ownerUid = request.auth.uid;
    const vehicleId = String(request.data.vehicleId || "").trim();
    const driverId = String(request.data.driverId || "").trim().toUpperCase();

    if (!vehicleId || !driverId) {
      throw new HttpsError("invalid-argument", "Vehicle ID और Driver ID जरूरी हैं।");
    }

    const vehicleRef = db.collection("vehicles").doc(vehicleId);
    const vehicleDoc = await vehicleRef.get();

    if (!vehicleDoc.exists) {
      throw new HttpsError("not-found", "Vehicle नहीं मिला।");
    }

    const vehicle = vehicleDoc.data();

    if (vehicle.ownerId !== ownerUid) {
      throw new HttpsError("permission-denied", "यह वाहन आपका नहीं है।");
    }

    const codeDoc = await db.collection("driverCodes").doc(driverId).get();

    if (!codeDoc.exists || codeDoc.data().active !== true) {
      throw new HttpsError("not-found", "गलत या बंद Driver ID है।");
    }

    const driverUid = codeDoc.data().uid;

    if (driverUid === ownerUid) {
      throw new HttpsError("invalid-argument", "मालिक स्वयं Driver नहीं हो सकता।");
    }

    const driverDoc = await db.collection("drivers").doc(driverUid).get();

    if (!driverDoc.exists || driverDoc.data().active !== true) {
      throw new HttpsError("not-found", "Driver उपलब्ध नहीं है।");
    }

    const driver = driverDoc.data();

    await vehicleRef.update({
      driverId: driverUid,
      driverPublicId: driverId,
      driverName: driver.name,
      driverAssignedAt: FieldValue.serverTimestamp()
    });

    return {
      success: true,
      message: "Driver सफलतापूर्वक जोड़ा गया।"
    };
  }
);
