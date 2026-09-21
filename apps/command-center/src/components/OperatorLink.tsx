'use client';

import NextLink from 'next/link';
import React, { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** Privileged pages fetch when visited, not when their links enter the viewport. */
const OperatorLink = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<typeof NextLink>>(
  function OperatorLink(props, ref) {
    return <NextLink {...props} ref={ref} prefetch={false} />;
  },
);

export default OperatorLink;
