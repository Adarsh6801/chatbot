# Visual workflow workspace

Open an agent and select **Workflow**. The studio has a node library, draggable canvas, inspector, and emulator. Workflow execution is optional: agents without an enabled published flow keep their regular knowledge-base chat behavior.

## Build and connect

Choose a starter template or add nodes from the library. Drag node headers to arrange them. Click an output dot, then the next node’s input dot to connect them. Select a node to configure it in the inspector. Remove a connection from the inspector or reconnect the output to replace it.

| Node | Behavior |
| --- | --- |
| Start | Entry point for a new flow run |
| Intent | Matches example phrases and routes to an intent output or Otherwise |
| Message | Displays configured text, including saved variables |
| Capture | Asks a question, waits for the next visitor message, validates it, and saves a variable |
| Condition | Branches on equals, contains, exists, or greater-than checks |
| API | Makes a server-side GET/POST/PUT/PATCH/DELETE request; saves JSON under a variable |
| Knowledge | Retrieves only this agent’s source documents and returns a grounded, cited answer |
| End | Completes the run; subsequent messages start another run with retained variables |

Intent detection uses normalized phrase/keyword matching, so no paid model is necessary. Write representative examples for each intent. It is not an unrestricted natural-language intent classifier; test ambiguous and paraphrased questions before publishing.

The variable `message` contains the current visitor message. `original_message` retains the message that started the run, which is useful when a Capture node collects an email or order number before a Knowledge node. Custom variables belong to a single conversation and cannot access another visitor’s values.

## API example

Use the **Order lookup with API** template:

1. Capture an order number as `order_id`.
2. Configure the API URL as `https://your-service.example.com/orders/{{order_id}}`.
3. Add optional authorization, such as `Bearer YOUR_TOKEN`, in the protected field.
4. Save the response as `api_result`.
5. Connect Success to a Message containing `Your order status is {{api_result.data.status}}.`.
6. Connect Error to a Knowledge node or an explicit service-unavailable reply.

Dynamic path/query values are URL-encoded. Nested response fields support paths such as `api_result.data.items.0.status`. JSON body fields containing an exact `{{variable}}` retain the variable’s number/object type. No JavaScript or Python expressions are evaluated.

API calls target fixed public hosts only, reject private/reserved addresses, pin the DNS result, block redirects, have a 15-second timeout and a 256 KB response limit. API calls can have side effects when configured with POST/PUT/PATCH/DELETE; testing the draft executes those configured calls too. Use a test endpoint while developing. Authentication values are encrypted at rest and omitted from returned graph data and execution traces.

Local development stores the encryption key in `data/workflow-encryption.key`, which is excluded from source control. Production requires `WORKFLOW_ENCRYPTION_KEY`, a Fernet key shared by API replicas and preserved across deployment. Generate it with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`, then save it privately in the environment.

## Test and publish

Save the draft and open Emulator. Send a message, answer capture questions, and inspect the execution steps. Executed canvas nodes highlight; waiting and failed steps appear in the trace. The emulator maintains its own test variables and does not create visitor conversations or count against the monthly message quota.

**Publish workflow** validates connections and required settings, snapshots the draft, increments its version, and enables execution. Hosted/embedded chat use the published version; later draft edits do not change live behavior. Publishing a workflow does not itself make the agent public: use the agent’s Deploy tab when you want a hosted page or widget. Disable the workflow from the library to return to ordinary knowledge chat.

A new workflow version resets the stored workflow state on the next conversation message. Circular graphs are rejected, and runtime execution is limited to 40 steps. Capture is the supported way to pause for another visitor message. The studio currently provides one Main workflow per agent, with branched paths rather than separate named sub-workflows.

## Account setup

Use the top-right account menu for **My profile**, **Subscribe & billing**, and **Log out**. The sidebar also includes a labeled logout action. Profile edits persist to the signed-in account. Google registration creates a user profile and session; linking Google from an existing profile preserves that user’s workspace identity.

The app’s `/setup` page lists Google OAuth and Stripe configuration. Google sign-in requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and an exact `GOOGLE_REDIRECT_URI`. Subscriptions require Stripe credentials, both recurring price IDs, and a signed webhook endpoint. Those service accounts are not provisioned by the project. A paid subscription’s upgrades are routed through the customer portal to avoid duplicate subscriptions.
