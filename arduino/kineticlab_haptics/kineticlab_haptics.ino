/*
 * KineticLab — Arduino Haptic + LCD Controller
 * -----------------------------------------------
 * Grove Base Shield pins:
 *   D3  → Grove LED (or bare LED via LED Socket Kit)
 *   D6  → Grove Buzzer
 *   I2C → Grove LCD RGB Backlight V4.0
 *
 * Serial protocol (from Python pyserial bridge):
 *   "buzz\n"         → short buzz + LED flash (target hit)
 *   "led_on\n"       → LED on solid
 *   "led_off\n"      → LED off
 *   "score:XX\n"     → update LCD with FMA-UE score (e.g. "score:47")
 *   "reset\n"        → clear LCD, all off
 *
 * Install before uploading:
 *   Arduino IDE → Library Manager → search "Grove LCD RGB" → install
 *   "Grove - LCD RGB Backlight" by Seeed Studio
 */

#include <Wire.h>
#include "rgb_lcd.h"

// ── Pin assignments ─────────────────────────────────────────────────────────
#define PIN_LED      3
#define PIN_BUZZER   6

// ── LCD ─────────────────────────────────────────────────────────────────────
rgb_lcd lcd;
int currentScore = 0;
bool lcdReady = false;

// ── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);

  pinMode(PIN_LED,     OUTPUT);
  pinMode(PIN_BUZZER,  OUTPUT);

  digitalWrite(PIN_LED,     LOW);
  digitalWrite(PIN_BUZZER,  LOW);

  // Init LCD
  lcd.begin(16, 2);
  lcd.setRGB(0, 100, 255);   // KineticLab blue
  lcd.print("KineticLab");
  lcd.setCursor(0, 1);
  lcd.print("FMA-UE: --");
  lcdReady = true;

  Serial.println("READY");   // signals Python bridge that Arduino is up
}

// ── Helpers ─────────────────────────────────────────────────────────────────
void doBuzz(int durationMs) {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(durationMs);
  digitalWrite(PIN_BUZZER, LOW);
}

void doLedFlash(int durationMs) {
  digitalWrite(PIN_LED, HIGH);
  delay(durationMs);
  digitalWrite(PIN_LED, LOW);
}

void updateLCD(int score) {
  // Colour-code severity bands (FMA-UE):
  //   severe   0-19  → red
  //   moderate 20-47 → yellow/orange
  //   mild     48-66 → green
  if (score < 20) {
    lcd.setRGB(255, 30, 30);   // red
  } else if (score < 48) {
    lcd.setRGB(255, 140, 0);   // orange
  } else {
    lcd.setRGB(30, 200, 80);   // green
  }

  lcd.clear();
  lcd.print("KineticLab Rehab");
  lcd.setCursor(0, 1);
  lcd.print("FMA-UE: ");
  lcd.print(score);
  lcd.print("/52");
}

// ── Main loop ────────────────────────────────────────────────────────────────
void loop() {
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "buzz") {
      // Target hit — buzz + LED flash together
      digitalWrite(PIN_LED, HIGH);
      doBuzz(120);
      digitalWrite(PIN_LED, LOW);
      Serial.println("OK:buzz");

    } else if (cmd == "led_on") {
      digitalWrite(PIN_LED, HIGH);
      Serial.println("OK:led_on");

    } else if (cmd == "led_off") {
      digitalWrite(PIN_LED, LOW);
      Serial.println("OK:led_off");

    } else if (cmd.startsWith("score:")) {
      // e.g. "score:47"
      String val = cmd.substring(6);
      int score = val.toInt();
      currentScore = score;
      updateLCD(score);
      // Also do a quick flash to acknowledge score update
      doLedFlash(80);
      Serial.println("OK:score:" + String(score));

    } else if (cmd == "reset") {
      digitalWrite(PIN_LED,     LOW);
      digitalWrite(PIN_BUZZER,  LOW);
      lcd.clear();
      lcd.setRGB(0, 100, 255);
      lcd.print("KineticLab");
      lcd.setCursor(0, 1);
      lcd.print("FMA-UE: --");
      currentScore = 0;
      Serial.println("OK:reset");

    } else {
      Serial.println("ERR:unknown:" + cmd);
    }
  }
}
