ALTER TABLE `functions` ADD `rateLimitPerMinute` int DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_budgets` ADD `webhookUrl` varchar(2048);--> statement-breakpoint
ALTER TABLE `tenant_budgets` ADD `lastAlertPeriod` varchar(7);--> statement-breakpoint
ALTER TABLE `tenant_budgets` ADD `lastAlertStatus` varchar(24);