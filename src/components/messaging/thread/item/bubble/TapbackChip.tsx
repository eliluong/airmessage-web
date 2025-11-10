import React, {useContext, useMemo} from "react";
import {TapbackType} from "shared/data/stateCodes";
import TapbackLoveIcon from "shared/components/icon/TapbackLoveIcon";
import TapbackLikeIcon from "shared/components/icon/TapbackLikeIcon";
import TapbackDislikeIcon from "shared/components/icon/TapbackDislikeIcon";
import TapbackLaughIcon from "shared/components/icon/TapbackLaughIcon";
import TapbackEmphasisIcon from "shared/components/icon/TapbackEmphasisIcon";
import TapbackQuestionIcon from "shared/components/icon/TapbackQuestionIcon";
import {Stack, Tooltip, Typography} from "@mui/material";
import {Theme} from "@mui/material/styles";
import {PeopleContext} from "shared/state/peopleState";

/**
 * A single tapback chip
 * @param props.type The type of tapback
 * @param props.count The amount of reactions of this tapback type
 */
export default function TapbackChip(props: {
        type: TapbackType;
        count: number;
        senders: readonly string[];
}) {
        const peopleState = useContext(PeopleContext);
        let Icon: React.ElementType;
        switch(props.type) {
                case TapbackType.Love:
			Icon = TapbackLoveIcon;
			break;
		case TapbackType.Like:
			Icon = TapbackLikeIcon;
			break;
		case TapbackType.Dislike:
			Icon = TapbackDislikeIcon;
			break;
		case TapbackType.Laugh:
			Icon = TapbackLaughIcon;
			break;
		case TapbackType.Emphasis:
			Icon = TapbackEmphasisIcon;
			break;
		case TapbackType.Question:
			Icon = TapbackQuestionIcon;
			break;
	}
	
        const tooltipTitle = useMemo(() => (
                props.senders
                        .map((sender) => {
                                const trimmedSender = sender.trim();
                                if(!trimmedSender) {
                                        return "Unknown sender";
                                }

                                const name = peopleState.getPerson(sender)?.name?.trim();
                                return name || trimmedSender;
                        })
                        .join(", ")
        ), [props.senders, peopleState]);

        return (
                <Tooltip title={tooltipTitle} placement="top" disableInteractive>
                        <Stack
                                sx={{
                                        paddingX: "6px",
                                        minWidth: 8,
                                        height: 18,
                                        borderStyle: "solid",
                                        borderRadius: 4,
                                        borderWidth: 2,
                                        backgroundColor: "messageIncoming.main",
                                        borderColor: "background.default"
                                }}
                                direction="row"
                                alignItems="center"
                                justifyContent="center">
                                <Icon
                                        sx={{
                                                color: (theme: Theme) => theme.palette.text.secondary,
                                                width: 12,
                                                height: 12
                                        }} />

                                {props.count > 1 && (
                                        <Typography variant="body2" color="secondary">
                                                {props.count}
                                        </Typography>
                                )}
                        </Stack>
                </Tooltip>
        );
}
