export type Invoice = {id:string;status:string;amount:string;note:string;filedAt:string;revisionConflict?:boolean};
export type Agreement = {id:string;origin:"owner"|"payee";status:string;terms?:{maxAmount:string;until:string};amount:string;note:string;submission:string;at:string};
export type PublicWorkOrder = {id:string;note:string;amount:string;until:string;createdAt:string;ready:boolean;unavailable:boolean;invoice:{status:string}|null};
