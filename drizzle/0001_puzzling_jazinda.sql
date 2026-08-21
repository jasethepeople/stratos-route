CREATE TABLE `functions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`runtime` enum('javascript','python') NOT NULL,
	`source` text NOT NULL,
	`triggerId` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `functions_id` PRIMARY KEY(`id`),
	CONSTRAINT `functions_trigger_unique` UNIQUE(`triggerId`),
	CONSTRAINT `functions_user_name_unique` UNIQUE(`userId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `invocations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`functionId` int NOT NULL,
	`provider` enum('aws','cloudflare','gcp') NOT NULL,
	`status` enum('success','error') NOT NULL,
	`durationMs` int NOT NULL,
	`billableUnits` int NOT NULL,
	`costMicros` int NOT NULL,
	`timestampMs` bigint NOT NULL,
	CONSTRAINT `invocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `functions` ADD CONSTRAINT `functions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invocations` ADD CONSTRAINT `invocations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invocations` ADD CONSTRAINT `invocations_functionId_functions_id_fk` FOREIGN KEY (`functionId`) REFERENCES `functions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `functions_user_idx` ON `functions` (`userId`);--> statement-breakpoint
CREATE INDEX `invocations_user_idx` ON `invocations` (`userId`);--> statement-breakpoint
CREATE INDEX `invocations_function_idx` ON `invocations` (`functionId`);--> statement-breakpoint
CREATE INDEX `invocations_timestamp_idx` ON `invocations` (`timestampMs`);