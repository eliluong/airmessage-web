import React, {useCallback} from "react";
import {PersonData} from "shared/interface/people/peopleUtils";

export interface PeopleState {
	needsPermission: boolean,
	getPerson(address: string): PersonData | undefined;
	allPeople: PersonData[] | undefined;
}

export const PeopleContext = React.createContext<PeopleState>({
	needsPermission: false,
	getPerson: () => undefined,
	allPeople: undefined
});

export function PeopleContextProvider(props: {
        children?: React.ReactNode;
        ready?: boolean;
}) {
        const getPerson = useCallback((): PersonData | undefined => undefined, []);

        return (
                <PeopleContext.Provider value={{
                        needsPermission: false,
                        getPerson,
                        allPeople: undefined
                }}>
                        {props.children}
                </PeopleContext.Provider>
        );
}
