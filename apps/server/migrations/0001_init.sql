-- Rig's database. Better Auth's tables come from scripts/auth-schema.ts (Better Auth 1.7).

CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "deviceCode" ("id" text not null primary key, "deviceCode" text not null, "userCode" text not null, "userId" text, "expiresAt" date not null, "status" text not null, "lastPolledAt" date, "pollingInterval" integer, "clientId" text, "scope" text);

CREATE TABLE "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

CREATE INDEX "session_userId_idx" on "session" ("userId");

CREATE INDEX "account_userId_idx" on "account" ("userId");

CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");

CREATE UNIQUE INDEX "deviceCode_deviceCode_uidx" on "deviceCode" ("deviceCode");

CREATE UNIQUE INDEX "deviceCode_userCode_uidx" on "deviceCode" ("userCode");
-- Rig's own tables. A PC is keyed by account and machine id, so the same PC
-- can be on two accounts (say, after signing out and into another one).
CREATE TABLE machine (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  id TEXT NOT NULL,
  view TEXT NOT NULL,
  inventory TEXT,
  facts TEXT,
  changes TEXT,
  games TEXT,
  identity TEXT,
  identity_at TEXT,
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- One point per 10 minutes from the desktop app, kept for 30 days.
CREATE TABLE machine_history (
  user_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  cpu REAL,
  gpu REAL,
  busy INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, machine_id, t),
  FOREIGN KEY (user_id, machine_id) REFERENCES machine (user_id, id) ON DELETE CASCADE
);

-- Questions asked per account per day, for the free daily allowance.
CREATE TABLE chat_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
