'use client';
import {use} from 'react';
import DocumentationCenter from '@/components/DocumentationCenter';
export default function DocumentationArticlePage({params}:{params:Promise<{slug:string}>}){const {slug}=use(params);return <DocumentationCenter slug={slug}/>;}
