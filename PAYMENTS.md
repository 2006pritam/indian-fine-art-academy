# UPI payments

Set these server environment variables locally in `.env`, or in the Render service settings:

| Variable | Value |
| --- | --- |
| `PAYMENT_API_KEY` | Your gateway API key, never a path to an `.env` file. |
| `PAYMENT_API_URL` | `https://famapi.mistahub.in/api` |
| `PUBLIC_APP_URL` | The browser URL of this academy, such as `https://imfaa.onrender.com` in production or `http://localhost:5173` locally. Render's `RENDER_EXTERNAL_URL` is used if this is omitted. |

Set the fee for each class in the admin portal. An explicitly configured fee of zero is free; an unset fee cannot be submitted as a free exam.

Run `npm run build`, then restart the server with `npm run server`. Startup adds the payment order history and correction metadata and copies existing order references. Existing exam forms are retained.

The gateway contract is `POST /create-order` with `{ amount, redirect_url }` (amount in INR rupees), followed by `GET /status/:orderId`. Both requests use the server's Bearer API key. A browser return URL does not prove payment: only a verified gateway response or an admin correction marks the form paid.

The student portal checks unresolved orders every 15 seconds while visible and when returning from a UPI app. The server also checks up to 25 forms every minute while it is running, so a student does not have to return from checkout. A sleeping hosting service resumes these checks after waking. Pending orders are reused; failed attempts are retained so a delayed success is still recognized.

In **Admin → Exam Forms → Payment**, use **Mark paid** (or **Accept Cash**) or **Mark unpaid** after checking the transaction. The admin ID and correction time are recorded. Automatic checks respect this manual correction, and further checkout is blocked until the admin resolves it. Marking unpaid also withdraws a released admit card. Student details remain visible after the update.

Run `npm test` for payment regression tests. They use temporary, in-memory PostgreSQL and simulated gateway responses, without reading production credentials or making charges. A live checkout and return still need to be verified with the deployed gateway configuration.
