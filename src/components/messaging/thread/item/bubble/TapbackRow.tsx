import React, {useMemo} from "react";
import {TapbackItem} from "shared/data/blocks";
import {TapbackType} from "shared/data/stateCodes";
import {Stack} from "@mui/material";
import TapbackChip from "shared/components/messaging/thread/item/bubble/TapbackChip";

/**
 * A row of tapback chips, to be attached to the bottom
 * of a message bubble
 */
export default function TapbackRow(props: {
	tapbacks: TapbackItem[]
}) {
        // Group standard tapbacks by type and emoji tapbacks by emoji payload.
        const tapbackGroups = useMemo(() => {
                const accumulator = new Map<string, {type: TapbackType; senders: string[]; emoji?: string}>();
                for(const item of props.tapbacks) {
                        if(item.tapbackType === TapbackType.Emoji && !item.tapbackEmoji) {
                                throw new Error("Emoji tapback missing emoji payload");
                        }
                        const key = item.tapbackType === TapbackType.Emoji
                                ? `emoji:${item.tapbackEmoji}`
                                : `type:${item.tapbackType}`;
                        const existing = accumulator.get(key);
                        if(existing) {
                                existing.senders.push(item.sender);
                        } else {
                                accumulator.set(key, {
                                        type: item.tapbackType,
                                        senders: [item.sender],
                                        emoji: item.tapbackEmoji
                                });
                        }
                }
                return Array.from(accumulator.entries()).map(([key, value]) => ({key, ...value}));
        }, [props.tapbacks]);
		
	return (
		<Stack
			sx={{
				zIndex: 1,
				position: "absolute",
				bottom: -12,
				right: 0
			}}
			direction="row"
			gap={0.5}>
                        {tapbackGroups.map((group) => {
                                if(group.type === TapbackType.Emoji) {
                                        if(!group.emoji) throw new Error("Emoji tapback group missing emoji payload");
                                        return (
                                                <TapbackChip
                                                        key={group.key}
                                                        type={TapbackType.Emoji}
                                                        emoji={group.emoji}
                                                        count={group.senders.length}
                                                        senders={group.senders}
                                                />
                                        );
                                }
                                return (
                                        <TapbackChip
                                                key={group.key}
                                                type={group.type}
                                                count={group.senders.length}
                                                senders={group.senders}
                                        />
                                );
                        })}
                </Stack>
        );
}
