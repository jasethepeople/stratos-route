CREATE TABLE `function_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`functionId` int NOT NULL,
	`version` int NOT NULL,
	`runtime` enum('javascript','python') NOT NULL,
	`source` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `function_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `function_versions_function_version_unique` UNIQUE(`functionId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `tenant_budgets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`monthlyLimitMicros` int NOT NULL DEFAULT 2000000,
	`alertThresholdPercent` int NOT NULL DEFAULT 80,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenant_budgets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_budgets_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `functions` ADD `triggerSecret` varchar(96) NOT NULL;--> statement-breakpoint
ALTER TABLE `functions` ADD `currentVersion` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `function_versions` ADD CONSTRAINT `function_versions_functionId_functions_id_fk` FOREIGN KEY (`functionId`) REFERENCES `functions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_budgets` ADD CONSTRAINT `tenant_budgets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `function_versions_function_idx` ON `function_versions` (`functionId`);