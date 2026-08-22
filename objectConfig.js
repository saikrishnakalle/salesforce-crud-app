// Central definition of which Standard Objects are exposed in the UI dropdown
// and which fields (min 5, max 10) are shown / editable for each object.
//
// "type" drives what kind of <input> the frontend renders.
// "nameField" is used as the human-readable title for a record row.

const OBJECT_CONFIG = {
  Account: {
    label: "Account",
    nameField: "Name",
    fields: [
      { name: "Name", label: "Account Name", type: "text", required: true },
      { name: "Industry", label: "Industry", type: "text" },
      { name: "Phone", label: "Phone", type: "text" },
      { name: "Website", label: "Website", type: "text" },
      { name: "BillingCity", label: "Billing City", type: "text" },
      { name: "AnnualRevenue", label: "Annual Revenue", type: "number" },
    ],
  },
  Opportunity: {
    label: "Opportunity",
    nameField: "Name",
    fields: [
      { name: "Name", label: "Opportunity Name", type: "text", required: true },
      { name: "StageName", label: "Stage", type: "text", required: true },
      { name: "Amount", label: "Amount", type: "number" },
      { name: "CloseDate", label: "Close Date", type: "date", required: true },
      { name: "Probability", label: "Probability (%)", type: "number" },
      { name: "Type", label: "Type", type: "text" },
    ],
  },
  Lead: {
    label: "Lead",
    nameField: "Name", // computed FirstName + LastName, read only display
    fields: [
      { name: "FirstName", label: "First Name", type: "text" },
      { name: "LastName", label: "Last Name", type: "text", required: true },
      { name: "Company", label: "Company", type: "text", required: true },
      { name: "Email", label: "Email", type: "email" },
      { name: "Status", label: "Status", type: "text" },
      { name: "Phone", label: "Phone", type: "text" },
    ],
  },
  Contact: {
    label: "Contact",
    nameField: "Name",
    fields: [
      { name: "FirstName", label: "First Name", type: "text" },
      { name: "LastName", label: "Last Name", type: "text", required: true },
      { name: "Email", label: "Email", type: "email" },
      { name: "Phone", label: "Phone", type: "text" },
      { name: "Title", label: "Title", type: "text" },
      { name: "MailingCity", label: "Mailing City", type: "text" },
    ],
  },
  Case: {
    label: "Case",
    nameField: "Subject",
    fields: [
      { name: "Subject", label: "Subject", type: "text", required: true },
      { name: "Status", label: "Status", type: "text" },
      { name: "Priority", label: "Priority", type: "text" },
      { name: "Origin", label: "Origin", type: "text" },
      { name: "Description", label: "Description", type: "textarea" },
    ],
  },
};

module.exports = OBJECT_CONFIG;
