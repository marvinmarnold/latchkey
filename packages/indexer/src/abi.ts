// ABI fragment — only the Pulled event is needed for indexing.
export const LatchkeyBillingAbi = [
  {
    type: 'event',
    name: 'Pulled',
    inputs: [
      { name: 'caller', type: 'address', indexed: true },
      { name: 'gross',  type: 'uint256', indexed: false },
      { name: 'fee',    type: 'uint256', indexed: false },
    ],
  },
] as const
