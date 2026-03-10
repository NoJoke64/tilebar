# Tilebar

MVP for a Splitwise-style web app.

## Setup

1. Create a Firebase project and enable Google sign-in.
2. Create a Firestore database in test mode (for MVP).
3. Copy the Firebase web config into `.env.local`.
4. Run the app:

```bash
npm run dev
```

## Auth

- Google sign-in via Firebase Auth.
- Popup first with redirect fallback for popup-blocked browsers.
- Auth state is exposed via `AuthProvider` and `useAuth()`.

## Groups

- Create groups from the dashboard.
- Join groups via invite link `/join/{groupId}`.
- Groups are stored in the `groups` collection with `memberUids` + `members`.

## Expenses

- Add expenses inside a group.
- Stored in the `expenses` collection with `groupId`, `amount`, `title`, `description`, `payerUids`, `participantUids`, `split`, `createdAt`.
- Split is equal across selected participants for MVP.
- Multiple payers are supported (amount split evenly among selected payers for now).

## Balances

- Group page shows net balances per member (paid minus share).
- Calculated from stored expenses and split data.

## Stage 2 additions

- Real-time updates for groups, expenses, and settlements.
- Debt simplification suggestions plus settlement recording.
- Firestore security rules in `firestore.rules`.

To deploy rules with Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

## Account settings

- Update display name.

## Stage 3 (receipt scanning)

- Upload a receipt image and parse it via Gemini.
- Parsed line items are editable before saving as an expense.
- Configure server-side Gemini access:

```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_BASE=https://generativelanguage.googleapis.com/v1beta/models
```
