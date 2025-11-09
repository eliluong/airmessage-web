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
        //Group tapbacks by type to calculate counts and tooltip content
        const tapbacksByType = useMemo(() =>
                props.tapbacks.reduce<Map<TapbackType, string[]>>((accumulator, item) => {
                        const key = item.tapbackType;
                        const existingSenders = accumulator.get(key);
                        if(existingSenders) {
                                existingSenders.push(item.sender);
                        } else {
                                accumulator.set(key, [item.sender]);
                        }
                        return accumulator;
                }, new Map())
        , [props.tapbacks]);
	
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
                        {Array.from(tapbacksByType.entries()).map(([tapbackType, senders]) => (
                                <TapbackChip
                                        key={tapbackType}
                                        type={tapbackType}
                                        count={senders.length}
                                        senders={senders}
                                />
                        ))}
                </Stack>
        );
}
