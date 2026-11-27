package app

import (
	"context"
	"fmt"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
)

// Use the shared connection config, not a Consumer config containing Go-only
// consumer settings. The admin client never joins the group or changes offsets.
func checkStaticConsumerAbsent(config kafka.ConfigMap, groupID, instanceID string) error {
	admin, err := kafka.NewAdminClient(&config)
	if err != nil {
		return err
	}
	defer admin.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := admin.DescribeConsumerGroups(ctx, []string{groupID})
	if err != nil {
		return err
	}
	return staticConsumerAbsent(result, groupID, instanceID)
}

func staticConsumerAbsent(result kafka.DescribeConsumerGroupsResult, groupID, instanceID string) error {
	if len(result.ConsumerGroupDescriptions) != 1 || result.ConsumerGroupDescriptions[0].GroupID != groupID {
		return fmt.Errorf("missing description for consumer group %s", groupID)
	}
	group := result.ConsumerGroupDescriptions[0]
	if group.Error.Code() != kafka.ErrNoError {
		return group.Error
	}
	if group.IsSimpleConsumerGroup || (group.State != kafka.ConsumerGroupStateStable && group.State != kafka.ConsumerGroupStateEmpty) {
		return fmt.Errorf("consumer group %s is not stable or empty: %s", groupID, group.State)
	}
	for _, member := range group.Members {
		// Even a member without partitions still owns its static identity.
		if member.GroupInstanceID == instanceID {
			return fmt.Errorf("static identity %s is still owned by member %s on %s", instanceID, member.ConsumerID, member.Host)
		}
	}
	return nil
}
