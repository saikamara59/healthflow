# Production runs on Fly, with AWS for documents and email

Production holds real Client PHI, so every vendor that touches it must sign a Business Associate Agreement. Production runs as its own Fly app with Fly Managed Postgres, both covered by Fly's BAA, while Documents live in AWS S3 and email goes through AWS SES under the AWS BAA. The Demo's document store, Tigris, publishes SOC 2 Type II but no BAA, so it stays in the Demo only.

We chose this over moving everything to AWS, which puts all PHI under one BAA but requires learning networking, IAM, and a container service before the first Design Partner signs in, and over a HIPAA platform such as Aptible, which costs more and adds a platform to learn. Staying on Fly reuses the existing image, deploy workflow, and smoke checks. The cost is two vendors to contract with and operate. Because the system is a container, Postgres, and S3-compatible storage, a later move to a single cloud is mostly reconfiguration.
