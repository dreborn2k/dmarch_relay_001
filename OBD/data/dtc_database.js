// DTC Database untuk Nissan Grand Livina L10 (berdasarkan manual resmi)
// Sumber: Nissan Grand Livina Engine Control System Manual (MR TYPE 1 & 2)

const dtcDatabase = {
    // Powertrain DTCs (P0xxx, P1xxx)
    "P0011": {
        description: "Intake Valve Timing Control Performance (Bank 1)",
        possibleCauses: [
            "Crankshaft position sensor (POS)",
            "Camshaft position sensor (PHASE)",
            "Intake valve timing control solenoid valve",
            "Accumulation of debris on camshaft signal pick-up",
            "Timing chain installation",
            "Foreign matter in oil groove for intake valve timing control"
        ],
        suggestion: "Periksa sensor posisi camshaft dan crankshaft, bersihkan atau ganti solenoid valve timing. Lakukan reset adaptasi ECM."
    },
    "P0102": {
        description: "Mass Air Flow Sensor Circuit Low Input",
        possibleCauses: [
            "Harness or connectors (MAF sensor circuit open or shorted)",
            "Intake air leaks",
            "Mass air flow sensor"
        ],
        suggestion: "Periksa konektor dan kabel MAF sensor, cek kebocoran udara intake, bersihkan atau ganti MAF sensor."
    },
    "P0103": {
        description: "Mass Air Flow Sensor Circuit High Input",
        possibleCauses: [
            "Harness or connectors (MAF sensor circuit open or shorted)",
            "Mass air flow sensor"
        ],
        suggestion: "Periksa konektor MAF, cek tegangan referensi 5V, ganti MAF sensor jika perlu."
    },
    "P0117": {
        description: "Engine Coolant Temperature Sensor Circuit Low Input",
        possibleCauses: [
            "Harness or connectors (ECT sensor circuit open or shorted)",
            "Engine coolant temperature sensor"
        ],
        suggestion: "Periksa konektor ECT sensor, ukur resistansi sensor pada suhu berbeda, ganti jika rusak."
    },
    "P0118": {
        description: "Engine Coolant Temperature Sensor Circuit High Input",
        possibleCauses: [
            "Harness or connectors (ECT sensor circuit open or shorted)",
            "Engine coolant temperature sensor"
        ],
        suggestion: "Periksa konektor dan kabel, ukur resistansi sensor, ganti sensor jika nilai tidak sesuai spesifikasi."
    },
    "P0122": {
        description: "Throttle Position Sensor 2 Circuit Low Input",
        possibleCauses: [
            "Harness or connectors (TP sensor 2 circuit open or shorted)",
            "Electric throttle control actuator (TP sensor 2)"
        ],
        suggestion: "Periksa konektor throttle body, cek tegangan referensi 5V, lakukan reset throttle position learning."
    },
    "P0123": {
        description: "Throttle Position Sensor 2 Circuit High Input",
        possibleCauses: [
            "Harness or connectors (TP sensor 2 circuit open or shorted)",
            "Electric throttle control actuator (TP sensor 2)"
        ],
        suggestion: "Periksa konektor dan kabel, ukur tegangan output TP sensor, ganti throttle body jika perlu."
    },
    "P0132": {
        description: "Heated Oxygen Sensor 1 Circuit High Voltage (Bank 1)",
        possibleCauses: [
            "Harness or connectors (HO2S1 circuit open or shorted)",
            "Heated oxygen sensor 1"
        ],
        suggestion: "Periksa konektor sensor oksigen depan, cek kebocoran exhaust, ganti sensor jika rusak."
    },
    "P0133": {
        description: "Heated Oxygen Sensor 1 Circuit Slow Response (Bank 1)",
        possibleCauses: [
            "Harness or connectors (HO2S1 circuit open or shorted)",
            "Heated oxygen sensor 1",
            "Fuel pressure",
            "Fuel injector",
            "Intake air leaks",
            "Exhaust gas leaks",
            "PCV valve",
            "Mass air flow sensor"
        ],
        suggestion: "Periksa sensor oksigen, cek kebocoran intake/exhaust, periksa MAF, lakukan adaptasi fuel trim."
    },
    "P0134": {
        description: "Heated Oxygen Sensor 1 Circuit No Activity Detected (Bank 1)",
        possibleCauses: [
            "Harness or connectors (HO2S1 circuit open or shorted)",
            "Heated oxygen sensor 1"
        ],
        suggestion: "Periksa konektor sensor, ukur resistansi heater, ganti sensor oksigen jika tidak responsif."
    },
    "P0135": {
        description: "Heated Oxygen Sensor 1 Heater Circuit (Bank 1)",
        possibleCauses: [
            "Harness or connectors (HO2S1 heater circuit open or shorted)",
            "Heated oxygen sensor 1 heater"
        ],
        suggestion: "Periksa sekring heater O2, ukur resistansi heater (3.4-4.4 ohm pada 25°C), ganti sensor."
    },
    "P0138": {
        description: "Heated Oxygen Sensor 2 Circuit High Voltage (Bank 1)",
        possibleCauses: [
            "Harness or connectors (HO2S2 circuit open or shorted)",
            "Heated oxygen sensor 2"
        ],
        suggestion: "Periksa konektor sensor oksigen belakang, cek catalytic converter, ganti sensor jika perlu."
    },
    "P0139": {
        description: "Heated Oxygen Sensor 2 Circuit Slow Response (Bank 1)",
        possibleCauses: [
            "Harness or connectors (HO2S2 circuit open or shorted)",
            "Heated oxygen sensor 2",
            "Fuel pressure",
            "Fuel injector",
            "Intake air leaks"
        ],
        suggestion: "Periksa sensor O2 belakang, cek efisiensi catalytic converter, periksa fuel trim."
    },
    "P0141": {
        description: "Heated Oxygen Sensor 2 Heater Circuit (Bank 1)",
        possibleCauses: [
            "Harness or connectors (HO2S2 heater circuit open or shorted)",
            "Heated oxygen sensor 2 heater"
        ],
        suggestion: "Periksa sekring, ukur resistansi heater, ganti sensor oksigen belakang."
    },
    "P0171": {
        description: "Fuel Injection System Too Lean (Bank 1)",
        possibleCauses: [
            "Intake air leaks",
            "Heated oxygen sensor 1",
            "Fuel injector",
            "Exhaust gas leaks",
            "Incorrect fuel pressure",
            "Lack of fuel",
            "Mass air flow sensor",
            "Incorrect PCV hose connection"
        ],
        suggestion: "Cek kebocoran vacuum, periksa MAF, cek tekanan bahan bakar, lakukan adaptasi fuel trim."
    },
    "P0172": {
        description: "Fuel Injection System Too Rich (Bank 1)",
        possibleCauses: [
            "Intake air leaks",
            "Heated oxygen sensor 1",
            "Fuel injector leaks",
            "Incorrect fuel pressure (too high)",
            "Mass air flow sensor"
        ],
        suggestion: "Periksa MAF (kotor atau rusak), cek tekanan bahan bakar berlebih, cek injector bocor."
    },
    "P0222": {
        description: "Throttle Position Sensor 1 Circuit Low Input",
        possibleCauses: [
            "Harness or connectors (TP sensor 1 circuit open or shorted)",
            "Electric throttle control actuator (TP sensor 1)"
        ],
        suggestion: "Periksa konektor throttle body, cek tegangan referensi, lakukan throttle position reset."
    },
    "P0223": {
        description: "Throttle Position Sensor 1 Circuit High Input",
        possibleCauses: [
            "Harness or connectors (TP sensor 1 circuit open or shorted)",
            "Electric throttle control actuator (TP sensor 1)"
        ],
        suggestion: "Periksa kabel dan konektor, ukur tegangan output, ganti throttle body jika perlu."
    },
    "P0300": {
        description: "Random/Multiple Cylinder Misfire Detected",
        possibleCauses: [
            "Improper spark plug",
            "Insufficient compression",
            "Incorrect fuel pressure",
            "Fuel injector circuit open or shorted",
            "Fuel injector",
            "Intake air leak",
            "Ignition signal circuit",
            "Lack of fuel",
            "Signal plate",
            "Heated oxygen sensor 1",
            "Incorrect PCV hose connection"
        ],
        suggestion: "Periksa busi, koil, kompresi, injektor, dan vacuum leak. Lakukan power balance test."
    },
    "P0301": {
        description: "Cylinder 1 Misfire Detected",
        possibleCauses: ["Same as P0300, specifically cylinder 1"],
        suggestion: "Periksa busi silinder 1, koil, injektor, dan kompresi silinder 1."
    },
    "P0302": {
        description: "Cylinder 2 Misfire Detected",
        possibleCauses: ["Same as P0300, specifically cylinder 2"],
        suggestion: "Periksa busi silinder 2, koil, injektor, dan kompresi silinder 2."
    },
    "P0303": {
        description: "Cylinder 3 Misfire Detected",
        possibleCauses: ["Same as P0300, specifically cylinder 3"],
        suggestion: "Periksa busi silinder 3, koil, injektor, dan kompresi silinder 3."
    },
    "P0304": {
        description: "Cylinder 4 Misfire Detected",
        possibleCauses: ["Same as P0300, specifically cylinder 4"],
        suggestion: "Periksa busi silinder 4, koil, injektor, dan kompresi silinder 4."
    },
    "P0327": {
        description: "Knock Sensor Circuit Low Input (Bank 1)",
        possibleCauses: [
            "Harness or connectors (Knock sensor circuit open or shorted)",
            "Knock sensor"
        ],
        suggestion: "Periksa konektor knock sensor, ukur resistansi, ganti knock sensor jika perlu."
    },
    "P0328": {
        description: "Knock Sensor Circuit High Input (Bank 1)",
        possibleCauses: [
            "Harness or connectors (Knock sensor circuit open or shorted)",
            "Knock sensor"
        ],
        suggestion: "Periksa kabel dan konektor, cek tegangan referensi, ganti knock sensor."
    },
    "P0335": {
        description: "Crankshaft Position Sensor Circuit",
        possibleCauses: [
            "Harness or connectors (CKP sensor circuit open or shorted)",
            "Crankshaft position sensor (POS)",
            "Accelerator pedal position sensor (shorted)",
            "Refrigerant pressure sensor (shorted)",
            "Signal plate"
        ],
        suggestion: "Periksa konektor CKP sensor, cek jarak sensor ke flywheel, ganti sensor jika rusak."
    },
    "P0340": {
        description: "Camshaft Position Sensor Circuit (Bank 1)",
        possibleCauses: [
            "Harness or connectors (CMP sensor circuit open or shorted)",
            "Camshaft position sensor (PHASE)",
            "Camshaft (Intake)",
            "Starter motor",
            "Starting system circuit",
            "Dead (Weak) battery"
        ],
        suggestion: "Periksa konektor CMP sensor, cek tegangan referensi, ganti sensor camshaft."
    },
    "P0420": {
        description: "Catalyst System Efficiency Below Threshold (Bank 1)",
        possibleCauses: [
            "Three way catalyst (manifold)",
            "Exhaust tube",
            "Intake air leaks",
            "Fuel injector",
            "Fuel injector leaks",
            "Spark plug",
            "Improper ignition timing"
        ],
        suggestion: "Periksa catalytic converter, cek sensor O2 belakang, perbaiki kebocoran exhaust."
    },
    "P0444": {
        description: "EVAP Canister Purge Volume Control Solenoid Valve Circuit Open",
        possibleCauses: [
            "Harness or connectors (Purge valve circuit open or shorted)",
            "EVAP canister purge volume control solenoid valve"
        ],
        suggestion: "Periksa konektor purge valve, ukur resistansi solenoid, ganti valve jika rusak."
    },
    "P0500": {
        description: "Vehicle Speed Sensor",
        possibleCauses: [
            "Harness or connectors (CAN communication line open or shorted)",
            "ABS actuator and electric unit (control unit)",
            "Wheel sensor",
            "Combination meter"
        ],
        suggestion: "Periksa sensor kecepatan di transmisi, cek wiring, periksa kombinasi meter dan ABS."
    },
    "P0605": {
        description: "Engine Control Module (ECM)",
        possibleCauses: ["ECM"],
        suggestion: "Kemungkinan ECM rusak. Periksa ground dan power supply, jika perlu ganti ECM dan lakukan inisialisasi NATS."
    },
    "P1111": {
        description: "Intake Valve Timing Control Solenoid Valve Circuit",
        possibleCauses: [
            "Harness or connectors (Solenoid valve circuit open or shorted)",
            "Intake valve timing control solenoid valve"
        ],
        suggestion: "Periksa konektor solenoid valve, ukur resistansi, ganti solenoid jika rusak."
    },
    "P1121": {
        description: "Electric Throttle Control Actuator",
        possibleCauses: ["Electric throttle control actuator"],
        suggestion: "Periksa throttle body, lakukan throttle position learning, ganti throttle body jika perlu."
    },
    "P1122": {
        description: "Electric Throttle Control Function",
        possibleCauses: [
            "Harness or connectors (Throttle control motor circuit open or shorted)",
            "Electric throttle control actuator"
        ],
        suggestion: "Periksa kabel throttle motor, lakukan reset throttle, ganti throttle body."
    },
    "P1124": {
        description: "Throttle Control Motor Relay Circuit Short",
        possibleCauses: [
            "Harness or connectors (Throttle control motor relay circuit shorted)",
            "Throttle control motor relay"
        ],
        suggestion: "Periksa relay throttle motor, cek kabel ke IPDM E/R, ganti relay jika perlu."
    },
    "P1126": {
        description: "Throttle Control Motor Relay Circuit Open",
        possibleCauses: [
            "Harness or connectors (Throttle control motor relay circuit open)",
            "Throttle control motor relay"
        ],
        suggestion: "Periksa fuse, relay, dan wiring throttle motor. Ganti relay jika rusak."
    },
    "P1128": {
        description: "Throttle Control Motor Circuit Short",
        possibleCauses: [
            "Harness or connectors (Throttle control motor circuit shorted)",
            "Electric throttle control actuator (Throttle control motor)"
        ],
        suggestion: "Periksa kabel throttle motor, ukur resistansi motor (1-15 ohm), ganti throttle body."
    },
    "P1217": {
        description: "Engine Over Temperature (Overheat)",
        possibleCauses: [
            "Cooling fan does not operate properly",
            "Cooling fan system",
            "Improper coolant filling method",
            "Coolant not within specified range",
            "Harness or connectors (cooling fan circuit)",
            "Cooling fan",
            "IPDM E/R",
            "Radiator hose",
            "Radiator",
            "Radiator cap",
            "Water pump",
            "Thermostat"
        ],
        suggestion: "Periksa level dan kualitas coolant, cek kerja kipas radiator, termostat, dan water pump."
    },
    "P1225": {
        description: "Closed Throttle Position Learning Performance",
        possibleCauses: ["Electric throttle control actuator (TP sensor 1 and 2)"],
        suggestion: "Lakukan prosedur throttle closed position learning menggunakan konsult atau pedal. Ganti throttle body jika gagal."
    },
    "P1226": {
        description: "Closed Throttle Position Learning Performance (repeatedly)",
        possibleCauses: ["Electric throttle control actuator (TP sensor 1 and 2)"],
        suggestion: "Lakukan throttle learning beberapa kali. Jika gagal, ganti throttle body."
    },
    "P1229": {
        description: "Sensor Power Supply Circuit Short",
        possibleCauses: [
            "Harness or connectors (APP sensor 1 circuit shorted)",
            "Throttle position sensor circuit shorted",
            "Camshaft position sensor circuit shorted",
            "Accelerator pedal position sensor",
            "Throttle position sensor",
            "Camshaft position sensor"
        ],
        suggestion: "Periksa tegangan referensi 5V ke sensor, cari korsleting pada salah satu sensor. Lepas satu per satu sensor untuk identifikasi."
    },
    "P1706": {
        description: "Park/Neutral Position Switch Circuit",
        possibleCauses: [
            "Harness or connectors (PNP switch circuit open or shorted)",
            "Park/neutral position (PNP) switch"
        ],
        suggestion: "Periksa konektor switch PNP pada transmisi, cek sinyal ke ECM, ganti switch jika rusak."
    },
    "P1715": {
        description: "Input Speed Sensor (Turbine Revolution Sensor)",
        possibleCauses: [
            "CAN communication line open or shorted",
            "Turbine revolution sensor circuit",
            "TCM (Transmission control module)"
        ],
        suggestion: "Periksa sensor kecepatan input transmisi, cek konektor, periksa CAN bus."
    },
    "P1805": {
        description: "Brake Switch Circuit",
        possibleCauses: [
            "Harness or connectors (Stop lamp switch circuit open or shorted)",
            "Stop lamp switch"
        ],
        suggestion: "Periksa saklar lampu rem, cek tegangan sinyal ke ECM, ganti saklar jika rusak."
    },
    "P2122": {
        description: "Accelerator Pedal Position Sensor 1 Circuit Low Input",
        possibleCauses: [
            "Harness or connectors (APP sensor 1 circuit open or shorted)",
            "Accelerator pedal position sensor (APP sensor 1)"
        ],
        suggestion: "Periksa konektor pedal sensor, cek tegangan referensi 5V, ganti pedal assembly jika perlu."
    },
    "P2123": {
        description: "Accelerator Pedal Position Sensor 1 Circuit High Input",
        possibleCauses: [
            "Harness or connectors (APP sensor 1 circuit open or shorted)",
            "Accelerator pedal position sensor (APP sensor 1)"
        ],
        suggestion: "Periksa kabel dan konektor, ukur tegangan output, ganti pedal sensor."
    },
    "P2127": {
        description: "Accelerator Pedal Position Sensor 2 Circuit Low Input",
        possibleCauses: [
            "Harness or connectors (APP sensor 2 circuit open or shorted)",
            "Accelerator pedal position sensor (APP sensor 2)",
            "Crankshaft position sensor (POS) circuit shorted",
            "Refrigerant pressure sensor circuit shorted"
        ],
        suggestion: "Periksa sensor pedal, cek korsleting dengan sensor CKP atau AC, ganti pedal assembly."
    },
    "P2128": {
        description: "Accelerator Pedal Position Sensor 2 Circuit High Input",
        possibleCauses: [
            "Harness or connectors (APP sensor 2 circuit open or shorted)",
            "Accelerator pedal position sensor (APP sensor 2)"
        ],
        suggestion: "Periksa konektor dan kabel, ukur tegangan output, ganti pedal sensor."
    },
    "P2135": {
        description: "Throttle Position Sensor Circuit Range/Performance",
        possibleCauses: [
            "Harness or connector (TP sensor 1 and 2 circuit open or shorted)",
            "Electric throttle control actuator (TP sensor 1 and 2)"
        ],
        suggestion: "Periksa konektor throttle body, ukur perbandingan tegangan TP1 dan TP2, lakukan reset throttle."
    },
    "P2138": {
        description: "Accelerator Pedal Position Sensor Circuit Range/Performance",
        possibleCauses: [
            "Harness or connector (APP sensor 1 and 2 circuit open or shorted)",
            "Accelerator pedal position sensor (APP sensor 1 and 2)",
            "Crankshaft position sensor circuit shorted",
            "Refrigerant pressure sensor circuit shorted"
        ],
        suggestion: "Periksa perbandingan tegangan APP1 dan APP2, cek korsleting dengan sensor lain, ganti pedal assembly."
    },
    // U-codes (CAN Communication)
    "U1000": {
        description: "CAN Communication Line (OBD related)",
        possibleCauses: ["Harness or connectors (CAN communication line open or shorted)"],
        suggestion: "Periksa jaringan CAN antara ECM, TCM, ABS, dan kombinasi meter. Cek resistor terminasi 120 ohm."
    },
    "U1001": {
        description: "CAN Communication Line (non-OBD related)",
        possibleCauses: ["Harness or connectors (CAN communication line open or shorted)"],
        suggestion: "Periksa jaringan CAN, pastikan tidak ada korsleting atau putus pada CAN H dan CAN L."
    },
    "U1010": {
        description: "CAN Communication Bus (ECM internal)",
        possibleCauses: ["ECM"],
        suggestion: "Kemungkinan ECM internal CAN controller error. Cek power dan ground, ganti ECM jika perlu."
    },
    // Default untuk DTC tidak dikenal
    "UNKNOWN": {
        description: "Kode DTC tidak dikenal atau tidak terdaftar dalam database.",
        possibleCauses: ["Periksa manual servis kendaraan."],
        suggestion: "Lakukan diagnosa lebih lanjut dengan alat scan profesional. Periksa wiring dan komponen terkait."
    }
};

// Fungsi untuk mengambil detail DTC (ekspor)
function getDTCDetails(code) {
    if (dtcDatabase[code]) {
        return dtcDatabase[code];
    } else {
        // Coba tanpa huruf depan? Tidak, kembalikan default
        return dtcDatabase["UNKNOWN"];
    }
}

// Jika menggunakan module (bisa juga langsung digunakan di global)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { dtcDatabase, getDTCDetails };
}