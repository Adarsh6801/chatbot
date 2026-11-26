"""First-run customer handbook content. Admins can fully edit it after seeding."""

DEFAULT_DOCUMENTATION = [
    {
        'title': 'Start here', 'slug': 'start-here', 'description': 'A quick orientation to AgentForge.', 'position': 0,
        'pages': [
            {'title': 'AgentForge at a glance', 'slug': 'agentforge-at-a-glance', 'summary': 'Understand what AgentForge does and how the pieces fit together.', 'position': 0, 'content': '''AgentForge helps you build support agents grounded in your own knowledge. You create an agent, add trusted sources, test its answers, then publish it as a hosted chat page or website widget.

## The main parts

- **Workspace:** manage agents, sources, conversations, account usage, and API credentials.
- **Knowledge:** uploaded documents and public URLs are indexed so an agent can retrieve relevant passages and cite sources.
- **Workflow Studio:** optionally route questions, collect information, evaluate conditions, call your own APIs, and send a final response.
- **Deployment:** publish a tested agent and add its widget to your website.
- **Admin console:** platform administrators manage accounts, billing, support, site settings, and documentation.

## A recommended first run

1. Create an account and open your workspace.
2. Create an agent with a clear name and purpose.
3. Add a small, representative set of help documents.
4. Wait for indexing to finish, then ask questions in the playground.
5. Check citations and test questions your sources do not answer.
6. Publish only after the answers and fallback behavior look right.

## What the agent can answer

The retrieval based answer flow uses the sources attached to that agent. If the available passages do not provide enough evidence, the agent may say it cannot answer rather than inventing a policy. Review conversations and improve the knowledge when it misses an important question.'''}
        ]
    },
    {
        'title': 'Build an agent', 'slug': 'build-an-agent', 'description': 'Create agents and prepare their knowledge.', 'position': 1,
        'pages': [
            {'title': 'Create and configure an agent', 'slug': 'create-an-agent', 'summary': 'Choose an agent name, describe its purpose, and test its response behavior.', 'position': 0, 'content': '''An agent is an independent assistant with its own instructions, knowledge sources, workflow, conversations, and deployment settings.

## Create an agent

Open **Agents** in the workspace and choose the create action. Give the agent a recognizable name and a short description that explains who it helps. Keep each agent focused on one service, product, or team so its knowledge stays relevant.

## Set its behavior

In agent settings, configure the greeting, appearance, and response instructions. Tell the agent what role it serves, what tone to use, and what it should do when the knowledge does not contain an answer. Keep factual product or policy material in knowledge sources so staff can update it without rewriting the agent instructions.

## Test before publishing

Use the playground to try common questions, variations in wording, and questions that are outside the agent's scope. Check that citations point to the expected source. Update the source or workflow when the result needs improvement, then repeat the same test questions.'''}
        ]
    },
    {
        'title': 'Knowledge', 'slug': 'knowledge', 'description': 'Add, index, and maintain the content your agent can use.', 'position': 2,
        'pages': [
            {'title': 'Add knowledge sources', 'slug': 'add-knowledge-sources', 'summary': 'Upload supported documents or import content from a public URL.', 'position': 0, 'content': '''Knowledge sources give an agent evidence to retrieve when it answers. Add sources from the agent's **Knowledge** page.

## Supported sources

- Upload PDF, DOCX, TXT, or Markdown files.
- Import a public web page by URL. The page must be reachable by the API server without signing in.
- Add text directly when you need to provide a short, manually maintained reference.

## Indexing and status

After adding a source, AgentForge extracts and splits its text, creates embeddings, and saves searchable chunks. The source appears as processing until indexing succeeds. If it fails, open the source record and review its error before retrying.

Scanned PDFs may contain no selectable text. Run OCR before uploading those files. For web pages, check that the URL is public and that the important content is present in the page's main text.

## Keep knowledge reliable

Upload the current approved version of policies and product information. Remove or replace outdated sources so conflicting revisions do not lead to uncertain answers. Use separate agents when teams need different source sets. After changing material, re-run the questions that depend on it.'''}
        ]
    },
    {
        'title': 'Workflows', 'slug': 'workflows', 'description': 'Shape conversations with visual workflow steps.', 'position': 3,
        'pages': [
            {'title': 'Design a workflow', 'slug': 'design-a-workflow', 'summary': 'Connect workflow nodes to route, collect, retrieve, and respond.', 'position': 0, 'content': '''The Visual Workflow Studio lets you define how a conversation proceeds. Workflows are optional; a published agent without an enabled workflow uses the standard knowledge grounded chat path.

## Common nodes

- **Start:** begins the workflow.
- **Message:** sends a fixed message or a message using captured variables.
- **Intent:** routes a conversation based on configured intents and examples.
- **Capture:** asks for and validates a value such as an email address.
- **Condition:** chooses an outcome based on a captured value.
- **API request:** calls an endpoint you configure and makes its response available to later steps.
- **Knowledge retrieval:** searches this agent's indexed sources.
- **End:** finishes the workflow path.

## Build and test

Connect each required output to a next node, including fallback paths. Add clear prompts and error messages for captured values and external requests. Test the draft with representative inputs in the workflow studio before publishing. Review API logs for request status and failures.

## Protect external integrations

Use HTTPS endpoints and only send the information the connected service needs. Store authorization using the workflow's protected credential field. Do not put secrets in message text, public widget configuration, or knowledge documents.'''}
        ]
    },
    {
        'title': 'Publish your agent', 'slug': 'publish-agent', 'description': 'Test, publish, and connect the website chat widget.', 'position': 4,
        'pages': [
            {'title': 'Publish and embed the chat widget', 'slug': 'publish-and-embed', 'summary': 'Make an agent public and add its small embed script to your website.', 'position': 0, 'content': '''Publishing makes an agent available to visitors. Review its name, greeting, color, sources, and test responses before publishing.

## Publish

Open the agent's **Deploy** page and publish the tested configuration. A draft change does not affect visitors until you publish it. Unpublishing disables public chat for that agent.

## Add the widget

Copy the embed snippet from the Deploy page and paste it before the closing `</body>` tag on your site. The generated code uses the agent's public widget key, not an account API secret. Keep the snippet's `data-agent-key` value intact.

```html
<script src="https://YOUR-API-HOST/widget.js"
        data-agent-key="YOUR_PUBLISHED_AGENT_PUBLIC_KEY"
        async></script>
```

Replace the example API host with the host serving your AgentForge API. For local development, the API commonly runs at `http://localhost:8000`; production should use HTTPS. You can preview the widget from the Deploy page before adding it to a live site.

## Common deployment checks

- The agent is published.
- The public key belongs to the intended agent.
- The API host is reachable from the visitor's browser.
- Production pages and API calls use HTTPS.
- Your site allows the API host through its content security policy, if one is configured.'''}
        ]
    },
    {
        'title': 'Conversations and analytics', 'slug': 'operations', 'description': 'Review customer conversations and improve the service.', 'position': 5,
        'pages': [
            {'title': 'Review conversations and improve answers', 'slug': 'review-conversations', 'summary': 'Inspect visitor messages, citations, and unanswered questions.', 'position': 0, 'content': '''Conversation history helps you understand what visitors ask and whether the agent has useful evidence.

## Review a conversation

Open the agent's **Conversations** page to view recent interactions. Select a conversation to inspect the message sequence, timestamps, and citations. Access to conversations is restricted to the agent's workspace owner and authorized administrators.

## Improve an answer

When a response is weak, identify the reason before changing configuration. The source may be missing, stale, difficult to extract, or phrased differently from the visitor's question. Add or update the approved source, then re-run the question in the playground.

## Analytics and evaluation

Agent analytics summarize message volume, response performance, and quality signals available to the workspace. Evaluation runs can sample questions and measure retrieval or answer quality. Treat evaluation results as a review aid: inspect individual examples before relying on a score to make a release decision.'''}
        ]
    },
    {
        'title': 'API and integrations', 'slug': 'api-integrations', 'description': 'Connect automation and monitor model usage.', 'position': 6,
        'pages': [
            {'title': 'Use API keys and the API', 'slug': 'api-keys-and-api', 'summary': 'Create account credentials for authenticated API calls and distinguish them from widget keys.', 'position': 0, 'content': '''Account API keys let an account authenticate supported AgentForge API requests without using a browser session. Use them for trusted server-side automation.

## Create and revoke a key

Open **API keys** in your workspace. Give each key a descriptive name, copy the secret when it is created, and store it in a secret manager. The full secret is shown only at creation. Revoke keys that are no longer used or may have been exposed.

## Authenticate a request

Send an account API key as a Bearer token from your server:

```sh
curl https://YOUR-API-HOST/api/v1/bots -H "Authorization: Bearer YOUR_ACCOUNT_API_KEY"
```

The API key grants the account-level permissions enforced by the endpoint. Never embed an account API key in browser code, a public repository, or the public widget snippet. Use the website's `/api-docs` page for the supported chat and workspace endpoints intended for users.

## Account API key versus widget key

An **account API key** authenticates trusted API requests as the account. An **agent public key** is used by the published chat widget. The widget key is designed to appear in a webpage; the account API key is a secret and must remain on your server.'''}
        ]
    },
    {
        'title': 'Plans and billing', 'slug': 'billing', 'description': 'Understand plan limits, subscriptions, and payments.', 'position': 7,
        'pages': [
            {'title': 'Plans, subscriptions, and payments', 'slug': 'plans-subscriptions-payments', 'summary': 'Compare plan access and manage recurring billing.', 'position': 0, 'content': '''Plan availability and limits are shown in the workspace and on the Plans page. Current application defaults include Free, Pro, and Team tiers; the configured production pricing and provider plan IDs determine checkout amounts.

## Upgrade or manage billing

Open **Plans** in your workspace, select the plan, and complete the hosted checkout. Subscription state can take time to update while the payment provider authorizes it. Use the in-app status check if checkout returns before the provider's subscription becomes active.

## Payment status and help

The platform processes provider webhooks and can also refresh the signed-in user's subscription status from the provider. Do not start another checkout while an existing subscription is being authorized. If status remains pending after the provider reports success, contact support with your account email and the provider subscription ID; never send a payment card number or API secret.

Administrators can review subscriptions and payments in the admin console. Provider credentials and webhook secrets belong only in the API server environment.'''}
        ]
    },
    {
        'title': 'Privacy and troubleshooting', 'slug': 'privacy-troubleshooting', 'description': 'Protect your account and solve common setup issues.', 'position': 8,
        'pages': [
            {'title': 'Security and data handling', 'slug': 'security-and-data', 'summary': 'Handle account credentials, knowledge, conversations, and integrations safely.', 'position': 0, 'content': '''Keep account and integration credentials private. AgentForge stores account API keys as hashes; the full key is shown only when it is created. Workflow authorization is protected separately from ordinary workflow settings.

## Information sent to external services

Uploaded sources and visitor messages are stored by the AgentForge service so the agent can retrieve knowledge and keep conversation history. If optional model providers, embedding providers, or Langfuse are configured, data needed for those services is sent to the configured provider. Langfuse traces can include visitor input and agent output. Configure providers according to your organization's privacy requirements and do not put secrets or unnecessary personal information in prompts or source files.

## Account safety

- Use a unique password or the configured single sign-on method.
- Store account API keys and provider credentials in server-side secret storage.
- Revoke credentials that are no longer needed.
- Restrict access to production admin accounts and review administrator activity.
- Use HTTPS in production and configure origins for your own domains.

Contact the platform administrator for questions about retention, backups, or deletion policies for your deployment.'''}
        ]
    },
    {
        'title': 'Troubleshooting', 'slug': 'troubleshooting', 'description': 'Resolve common indexing, publishing, and billing issues.', 'position': 9,
        'pages': [
            {'title': 'Common issues', 'slug': 'common-issues', 'summary': 'A checklist for indexing, agent answers, widgets, APIs, and subscriptions.', 'position': 0, 'content': '''## A source stays in processing or fails

Check the source's error message and confirm the file is a supported PDF, DOCX, TXT, or Markdown document. Scanned PDFs need OCR. URL imports must be reachable from the API server without a login. Retry after correcting the source.

## The answer is inaccurate or has no citation

Confirm that the relevant source is indexed and belongs to this agent. Check for conflicting or outdated source material. Test a direct question in the playground, then improve the source wording or workflow and try again.

## The widget does not appear

Confirm the agent is published, the correct agent public key is in the embed code, and the API URL is reachable from your page. Check the browser console for blocked scripts or content security policy errors. Use HTTPS for production.

## An API request returns unauthorized

Check the `Authorization: Bearer …` header, confirm the key is still active, and ensure you are using an account API key rather than an agent widget key. Revoke and replace a key if it might have been exposed.

## A subscription still shows pending

The provider may still be authorizing the subscription. Wait briefly, then refresh status in the Plans page. If the provider dashboard shows an active subscription but the workspace does not, contact support with the provider subscription ID and account email.

## Where to get help

Open **Support** in the workspace and create a ticket. Include the affected agent, approximate time, and a short description. Do not include passwords, full API keys, card details, or private customer data.'''}
        ]
    },
]
