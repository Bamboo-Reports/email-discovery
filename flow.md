# How the Email Engine Works

## 1. The one-sentence summary

This app takes a **person's name and their company website** and figures out their
**most likely work email**, and then **double-checks that the email is real**, all
**without ever sending them an actual email**.

It does two jobs:

1. **Find** an email we don't know (we have the name and the company).
2. **Verify** an email we already have (we just want to know if it works).

---

## 2. A simple example

Say we want to reach **Abhishek Fodikar** at **researchnxt.com**, but we don't know
his email.

Nobody hands us his address. So the app does what a smart person would do. It
**makes educated guesses** based on how company emails are usually built, and it
checks them in order from most likely to least likely:

| Order checked | Guess | Style | Confidence |
|---|---|---|---|
| 1 | abhishek.fodikar@researchnxt.com | first.last | 90% |
| 2 | afodikar@researchnxt.com | firstinitial + last | 75% |
| 3 | abhishek@researchnxt.com | first only | 65% |
| 4 | abhishekfodikar@researchnxt.com | firstlast | 60% |
| 5 | a.fodikar@researchnxt.com | firstinitial.last | 50% |
| 6 | abhishekf@researchnxt.com | first + lastinitial | 42% |
| 7 | fodikar@researchnxt.com | last only | 35% |
| 8 | fodikar.abhishek@researchnxt.com | last.first | 25% |
| 9 | fodikara@researchnxt.com | last + firstinitial | 20% |
| 10 | abhishek_fodikar@researchnxt.com | first_last | 15% |
| 11 | abhishek-fodikar@researchnxt.com | first-last | 12% |
| 12 | abhishek.f@researchnxt.com | first.lastinitial | 48% |

(The last one has a higher confidence than several above it, but it sits at the end
of the list because it was added to the playbook later. Everything else is in
plain most-likely-first order.)

The app **checks each guess** against the company's mail server until one comes
back as "yes, that mailbox is real." That one becomes the answer.

Once it learns that **researchnxt.com uses the first + lastinitial
style** (abhishekf@), it **remembers that**. The next time anyone looks up a
researchnxt.com employee, it tries that style **first**, usually getting it right
on the very first try. This saves time and money. More on that in Section 7.

---

## 3. How an email gets checked, using "Reacher"

**Reacher** is an open-source tool we run on our own server. Its job is to tell us
whether a mailbox exists **without sending any email**. Here is how:

1. **Is it even spelled like an email?**
   `abhishek.fodikar@researchnxt.com` looks valid. `abhishek@@research` does not.
   Quick sanity check.

2. **Can this company receive mail at all?**
   It looks up researchnxt.com's **mail servers** (the computers that accept email
   for that company). No mail server means a dead end.

3. **It phones up the company's mail server and starts a conversation.**
   Every email delivery begins with a short back-and-forth between two servers
   *before* the actual message is sent. It is like a courier ringing the doorbell
   and asking "Does Abhishek Fodikar live here?" *before* handing over the parcel.

4. **It asks the doorbell question: "Would you accept mail for abhishek.fodikar@researchnxt.com?"**
   - If the server says **"yes"**, the mailbox is real, so the result is **valid**.
   - If the server says **"no such person"**, the result is **invalid**.

5. **Then it hangs up. It never delivers the parcel.**
   No email is ever actually sent. Abhishek never gets anything. We only listen to
   how the doorman answers the question.

This is why the tool can check thousands of addresses without spamming anyone.

---

## 4. The "random email" trick (catch-all detection)

This is an important trick, and the answer is yes: **Reacher creates a random,
made-up email address to test whether a domain is "accept-all."**

**The problem:** Some companies set their mail server to say **"yes" to every
address**, real or not. These are called **catch-all** (or "accept-all") domains.
If we only asked "Is abhishek.fodikar@researchnxt.com real?" and got a "yes," we
could be fooled, because that server says yes to *everything*.

**The trick:** Before trusting a "yes," Reacher also asks the same doorbell
question about a **random address that could not possibly exist**, like:

> `q8x4m2p9z1abcde@researchnxt.com`

Now there are two outcomes:

- **The server rejects the random one.** Good. The server is honest, so its "yes"
  for Abhishek actually means something. We trust **valid**.
- **The server accepts the random one too.** It says yes to everything, so we
  cannot prove Abhishek's specific mailbox is real. We mark the result
  **accept-all (risky)**.

So the random email is an **honesty test for the mail server**. It is not about
disguising us. It is about catching servers that rubber-stamp everything.

---

## 5. The other things Reacher checks

Beyond the basic "does this mailbox exist" question, Reacher also looks at:

- **Role accounts.** Addresses like info@, support@, admin@, or sales@ are shared
  inboxes, not a specific person. Reacher flags these so we know it is not a real
  individual.
- **Disposable addresses.** Some addresses come from throwaway, ten-minute email
  services. Reacher knows those domains and flags them as not usable.
- **Disabled or full mailboxes.** The mail server sometimes signals that a mailbox
  exists but is switched off or full. Reacher reads those signals too.
- **"Couldn't tell" situations.** Some mail servers deliberately stall or
  temporarily block strangers who knock (a common anti-spam tactic called
  greylisting). When that happens, Reacher returns **unknown** instead of guessing.
  This matters because a stall is not the same as a real "no," and the app treats
  the two differently (see Section 8).
- **Encrypted, polite conversations.** It uses the secure, standard way of talking
  to mail servers, so the back-and-forth looks like normal, well-behaved email
  traffic.

---

## 6. Staying unblocked: the disguise tricks

Mail servers do not love being probed, and they can block whoever keeps knocking.
So the app wears a few disguises so the questions look ordinary and do not get our
real identity blacklisted:

| Trick | What it does | Plain-English reason |
|---|---|---|
| **Proxy** | All the doorbell calls go out through a rented proxy address | Keeps our real company server's address out of it, so we do not get our own systems blacklisted |
| **Neutral "from" identity** (verify@gmail.com) | When introducing itself in the conversation, it uses a generic, common identity instead of our company name | A generic identity looks like normal everyday traffic and does not reveal who is asking |
| **Neutral "hello" name** (gmail.com) | The greeting it uses to start the conversation is a common, unremarkable name | Same idea: blend in, do not stand out |
| **Private tunnel plus secret key** | Our website talks to the Reacher server through a secure private tunnel, and only requests carrying a secret password are allowed in | Security. Nobody else can use our Reacher server, and the server has no open doors to the public internet |

These are about *not getting our own infrastructure blocked* while doing legitimate
checks, not about deceiving the recipient. No email is ever sent.

---

## 7. The two money-saving and speed tricks

Checking emails costs either time (Reacher) or money (the paid service in the next
section). A few tricks keep both low:

1. **Pattern learning.**
   The moment the app confirms a real email for a company, it **saves which style
   worked**, and shares that knowledge **across the whole team** (stored in a shared
   database that survives restarts). The next person who looks up that company gets
   the right answer on the **first** guess instead of the fifth or sixth.

2. **Stop as soon as we win.**
   During guessing, the instant one address comes back valid, the app **stops**. It
   does not bother checking the remaining guesses.

3. **Free checker first.**
   Reacher, which we host ourselves so it is free per check, does the first pass.
   The paid service is only called when truly needed.

**A note on the hosting cost.** Reacher runs on our own small server (a Hetzner
VPS) that costs roughly **6 euros per month**. That is a flat fee no matter how
many checks we run, unlike the paid service which charges per check. So every
email Reacher confirms is effectively free, and the 6 euros a month is the only
fixed cost of keeping the free checker running.

---

## 8. The paid backup: MillionVerifier

We also have a paid verification service, **MillionVerifier**. It does the same kind
of check but as a polished commercial product, and each check costs one "credit"
from a prepaid balance.

The app can run in one of three modes:

- **Reacher only.** Free, self-hosted.
- **MillionVerifier only.** Paid, hands-off.
- **Both together.** The smart default, explained below.

**In "Both" mode, the logic is:**

1. **Reacher checks first** (free).
2. If Reacher says **valid** or **accept-all**, we **trust it and spend nothing**.
3. If Reacher says **invalid** or **couldn't tell**, we get a **second opinion from
   MillionVerifier** (paid), because Reacher's "no" is sometimes wrong (the server
   it called may have been temporarily stalling or blocking probes).

This way we only spend money on the **hard cases**, not the easy wins.

There is also a manual **"Check with MillionVerifier"** button so a user can force a
paid second opinion on any single result whenever they want extra certainty.

---

## 9. The four possible answers

Every check ends in one of four clear labels:

| Label | Means | Trust level |
|---|---|---|
| **Valid** | The mailbox appears to really exist | High, safe to use |
| **Invalid** | No such mailbox, disabled, or disposable | Don't use |
| **Accept-all** | The server says yes to everything, so we cannot be sure | Risky, use with caution |
| **Not found** | We couldn't get a clear answer (server blocked us, timed out, etc.) | Unconfirmed |

---

## 10. End-to-end flow

```
USER HAS...
   |
   |-- Name + company  ----------> FIND MODE
   |                                 |
   |                                 |- Already learned this company's style? -> try that guess first
   |                                 |- Otherwise -> generate all 12 guesses (best first)
   |                                 |
   |                                 v
   |                         CHECK EACH GUESS (Reacher, free)
   |                                 |
   |                                 |- "valid"      -> remember the style, STOP, return it
   |                                 |- "accept-all" -> return as risky
   |                                 |- none worked  -> (Both mode) sweep with MillionVerifier
   |
   |-- An exact email   ----------> VERIFY MODE
                                     |
                                     |- Reacher checks it (free)
                                     |- If unsure or negative -> MillionVerifier second opinion (paid)
                                     |
                                     v
                              RESULT: valid / invalid / accept-all / not found
                                     |
                                     v
                          SAVE to history (result + confidence)
                          LEARN the company's email style for next time
```

---

## 11. The rest of the product (briefly)

Around this core engine, the app also offers:

- **Single lookup.** Type one name and domain, get one answer.
- **Bulk CSV upload.** Drop in a spreadsheet of hundreds of people, watch a progress
  bar, then export all the results as a CSV.
- **Company domain suggestions.** Start typing a company name, and it suggests the
  right website (for example, "research" suggests researchnxt.com).
- **Login and history.** Everyone logs in, and every lookup is saved with its result
  and confidence score for auditing.
- **Admin dashboard.** See how many emails were found, how many paid credits are
  left, recent activity, and control who is allowed to do bulk runs.

---

## 12. Key takeaways

1. **It guesses smartly, then verifies**, using common email patterns ranked by how
   likely each one is.
2. **It never sends email.** It just asks the mail server's doorman if a mailbox
   exists, and uses a random fake address to catch servers that lie by saying yes to
   everyone.
3. **It learns and saves money.** Once it cracks a company's email style, the whole
   team benefits, and the free checker handles the easy cases so we only pay for the
   hard ones.

---

## 13. How this compares to Hunter.io

These are not homemade tricks. They are the same techniques the established
commercial tools are built on. Hunter.io, one of the best-known email finders,
publicly documents the same approach in its own help pages:

- **Pattern detection.** Hunter analyzes the emails it has seen for a company and
  works out the dominant format (firstname.lastname vs flast vs first), then uses
  that format to predict other people's addresses. This is exactly our **pattern
  learning** in Section 7.

- **Confidence score.** Hunter gives every email a 0 to 100 confidence score, and
  treats 90% and above as a high chance of being deliverable. We do the same thing
  with our per-pattern confidence numbers in Section 2.

- **Verification without sending email.** Hunter's Email Verifier runs a sequence
  of checks (valid format, MX records, SMTP server presence, then an SMTP check)
  and, in their own words, contacts the mail server "without sending any emails" to
  confirm the inbox exists. That is exactly what Reacher does in Sections 3 and 5.

- **Accept-all (catch-all) detection.** Hunter checks "if the server has a
  catch-all policy that accepts all incoming emails, even if the specified mailbox
  does not exist," and warns users to treat those results carefully. This is the
  same catch-all problem our random-email trick solves in Section 4.

- **Disposable and gibberish detection.** Hunter also flags throwaway domains and
  random-looking addresses, the same kind of extra checks listed in Section 5.

In short, our engine uses the same playbook as Hunter.io. The difference is that we
run the core checker (Reacher) on our own server for a flat 6 euros a month, instead
of paying per lookup.

**References (Hunter.io's public documentation):**

- What checks the Email Verifier performs:
  https://help.hunter.io/en/articles/1935168-what-checks-are-performed-on-an-email-with-the-email-verifier
- Email Verifier FAQs (confidence score and accept-all guidance):
  https://help.hunter.io/en/articles/12639509-email-verifier-faqs
