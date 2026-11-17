-- Rig's database (Postgres). Better Auth's tables come from scripts/auth-schema.ts (Better Auth 1.7).

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "deviceCode" ("id" text not null primary key, "deviceCode" text not null, "userCode" text not null, "userId" text, "expiresAt" timestamptz not null, "status" text not null, "lastPolledAt" timestamptz, "pollingInterval" integer, "clientId" text, "scope" text);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

create unique index "deviceCode_deviceCode_uidx" on "deviceCode" ("deviceCode");

create unique index "deviceCode_userCode_uidx" on "deviceCode" ("userCode");
-- Rig's own tables. A PC is keyed by account and machine id, so the same PC
-- can be on two accounts (say, after signing out and into another one).
create table machine (
  user_id text not null references "user" ("id") on delete cascade,
  id text not null,
  view jsonb not null,
  inventory jsonb,
  facts jsonb,
  changes jsonb not null default '[]',
  games jsonb not null default '[]',
  identity jsonb not null default '{}',
  identity_at timestamptz,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Temperature points from the desktop app (t is milliseconds since 1970), kept for 30 days.
create table machine_history (
  user_id text not null,
  machine_id text not null,
  t bigint not null,
  cpu real,
  gpu real,
  busy boolean not null default false,
  primary key (user_id, machine_id, t),
  foreign key (user_id, machine_id) references machine (user_id, id) on delete cascade
);

-- Questions asked per account per day, for the free daily allowance.
create table chat_usage (
  user_id text not null references "user" ("id") on delete cascade,
  day date not null,
  count integer not null,
  primary key (user_id, day)
);
